import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import type { Sample } from "./shared";

type CoreTimes = { busy: number; total: number };
type Gpu = NonNullable<Sample["gpu"]>;

const round = (value: number) => Math.round(value * 10) / 10;

function coreTimes(): CoreTimes[] {
  return os.cpus().map(({ times }) => {
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    return { busy: total - times.idle, total };
  });
}

/** Busy share of each core between two readings, 0–100. */
export function corePercents(
  before: readonly CoreTimes[],
  after: readonly CoreTimes[],
): number[] {
  return after.map((now, index) => {
    const then = before[index] ?? { busy: 0, total: 0 };
    const total = now.total - then.total;
    return total > 0 ? round((100 * (now.busy - then.busy)) / total) : 0;
  });
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 1500 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

/**
 * Memory in use the way Activity Monitor counts it: app memory, wired, and
 * compressed. Free, cached, and purgeable pages are left out.
 */
export function parseVmStat(text: string): number | null {
  const pageSize = Number(/page size of (\d+) bytes/u.exec(text)?.[1]);
  const pages = (label: string) =>
    Number(new RegExp(`${label}:\\s+(\\d+)`, "u").exec(text)?.[1] ?? NaN);
  const used =
    pages("Anonymous pages") -
    pages("Pages purgeable") +
    pages("Pages wired down") +
    pages("Pages occupied by compressor");
  return Number.isFinite(used) && pageSize > 0 ? used * pageSize : null;
}

/** Linux: everything but MemAvailable is in use. */
export function parseMemInfo(text: string): number | null {
  const kib = (label: string) =>
    Number(new RegExp(`^${label}:\\s+(\\d+) kB`, "mu").exec(text)?.[1] ?? NaN);
  const used = kib("MemTotal") - kib("MemAvailable");
  return Number.isFinite(used) ? used * 1024 : null;
}

async function usedMemory(): Promise<number> {
  try {
    if (process.platform === "darwin") {
      const used = parseVmStat(await run("vm_stat", []));
      if (used !== null) return used;
    } else if (process.platform === "linux") {
      const used = parseMemInfo(await readFile("/proc/meminfo", "utf8"));
      if (used !== null) return used;
    }
  } catch {
    // Fall through to Node's figure.
  }
  return os.totalmem() - os.freemem();
}

/** macOS: the first accelerator's utilization from the IORegistry. */
export function parseIoreg(text: string): Gpu | null {
  const percent = /"Device Utilization %"=(\d+)/u.exec(text)?.[1];
  if (percent === undefined) return null;
  const memory = /"In use system memory"=(\d+)/u.exec(text)?.[1];
  return {
    percent: Number(percent),
    name: /"model" = "([^"]+)"/u.exec(text)?.[1] ?? "GPU",
    memoryUsedBytes: memory === undefined ? null : Number(memory),
    memoryTotalBytes: null,
  };
}

/** NVIDIA: the busiest GPU from `nvidia-smi` CSV output. */
export function parseNvidiaSmi(text: string): Gpu | null {
  const gpus = text
    .trim()
    .split("\n")
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((cells) => cells.length === 4 && cells[0] !== "")
    .map(([name, percent, used, total]) => ({
      name: name ?? "GPU",
      percent: Number(percent),
      memoryUsedBytes: Number(used) * 1024 * 1024,
      memoryTotalBytes: Number(total) * 1024 * 1024,
    }))
    .filter((gpu) => Number.isFinite(gpu.percent));
  if (gpus.length === 0) return null;
  return gpus.reduce((busiest, gpu) =>
    gpu.percent > busiest.percent ? gpu : busiest,
  );
}

async function readGpu(): Promise<Gpu | null> {
  if (process.platform === "darwin") {
    return parseIoreg(
      await run("ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]),
    );
  }
  return parseNvidiaSmi(
    await run("nvidia-smi", [
      "--query-gpu=name,utilization.gpu,memory.used,memory.total",
      "--format=csv,noheader,nounits",
    ]),
  );
}

/** Reads one sample per call; CPU load covers the time since the last call. */
export function createSampler() {
  let previous = coreTimes();
  let gpuMissing = false;

  return async function sample(): Promise<Sample> {
    const now = coreTimes();
    const cores = corePercents(previous, now);
    previous = now;
    let gpu: Gpu | null = null;
    if (!gpuMissing) {
      // A machine with no readable GPU stops asking after the first miss.
      gpu = await readGpu().catch(() => null);
      gpuMissing = gpu === null;
    }
    return {
      at: Date.now(),
      cpu: {
        percent: round(
          cores.reduce((sum, core) => sum + core, 0) / (cores.length || 1),
        ),
        coreCount: cores.length,
        model: os.cpus()[0]?.model ?? "CPU",
      },
      memory: { usedBytes: await usedMemory(), totalBytes: os.totalmem() },
      gpu,
      hostname: os.hostname(),
      uptimeSeconds: os.uptime(),
    };
  };
}
