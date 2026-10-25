import { readdir, readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { ProcessInfo, rpcContract } from "./contract";
import { run } from "./stats";

/** One process as read from the system, with its CPU time so far. */
export type Proc = {
  pid: number;
  ppid: number;
  name: string;
  command: string;
  cpuSeconds: number;
  memoryBytes: number;
};
type Reading = { at: number; procs: Proc[] };

/** Command lines are cut to this many characters to keep the list small. */
const COMMAND_CHARS = 200;
/** A list younger than this is served again: several windows poll at once. */
const FRESH_MS = 1000;
/** CPU is measured over at least this long. */
const MIN_SPAN_MS = 500;
/** A reading older than this is too old to measure CPU against. */
const STALE_MS = 10_000;
/** Guard's daemon runs under launchd, outside BB's tree, but is part of BB. */
const GUARD_SCRIPT = "/bb-resource-monitor/guard/guard.mjs";
/** `ps` may be slow under heavy load, just when quitting matters most. */
const PS_TIMEOUT_MS = 5000;
/** Linux counts CPU time in ticks of 1/100 s (CLK_TCK). */
const TICKS_PER_SECOND = 100;

/**
 * macOS: `ps -axo pid=,ppid=,rss=,time=,comm=` with the command lines from
 * `ps -axo pid=,args=`. CPU time reads `M:SS.cc`; the name is the
 * executable's file name.
 */
export function parsePs(stats: string, args: string): Proc[] {
  const commands = new Map<number, string>();
  for (const line of args.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (match) commands.set(Number(match[1]), match[2].trim());
  }
  const procs: Proc[] = [];
  for (const line of stats.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+):([\d.]+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const [, pid, ppid, rss, minutes, seconds, comm] = match;
    procs.push({
      pid: Number(pid),
      ppid: Number(ppid),
      name: comm.slice(comm.lastIndexOf("/") + 1),
      command: (commands.get(Number(pid)) || comm).slice(0, COMMAND_CHARS),
      cpuSeconds: Number(minutes) * 60 + Number(seconds),
      memoryBytes: Number(rss) * 1024,
    });
  }
  return procs;
}

/** Linux: `/proc/<pid>/stat`, whose name may hold spaces and parentheses. */
export function parseProcStat(
  stat: string,
  cmdline: string,
  pageSize: number,
): Proc | null {
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const name = stat.slice(open + 1, close);
  const command = cmdline.replaceAll("\0", " ").trim() || name;
  // From the state on: ppid is field 4, utime and stime 14 and 15, rss 24.
  const fields = stat.slice(close + 2).split(" ");
  return {
    pid: Number(stat.slice(0, open)),
    ppid: Number(fields[1]),
    name,
    command: command.slice(0, COMMAND_CHARS),
    cpuSeconds: (Number(fields[11]) + Number(fields[12])) / TICKS_PER_SECOND,
    memoryBytes: Number(fields[21]) * pageSize,
  };
}

let pageSize: Promise<number> | undefined;

async function readProcFs(): Promise<Proc[]> {
  pageSize ??= run("getconf", ["PAGESIZE"]).then(
    (text) => Number(text) || 4096,
    () => 4096,
  );
  const size = await pageSize;
  const pids = (await readdir("/proc")).filter((name) => /^\d+$/u.test(name));
  const procs = await Promise.all(
    pids.map(async (pid) => {
      try {
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8");
        return parseProcStat(stat, cmdline, size);
      } catch {
        return null; // Gone mid-read.
      }
    }),
  );
  return procs.filter((proc) => proc !== null);
}

async function read(): Promise<Reading> {
  const at = performance.now();
  if (process.platform === "darwin") {
    const [stats, args] = await Promise.all([
      run("/bin/ps", ["-axo", "pid=,ppid=,rss=,time=,comm="], PS_TIMEOUT_MS),
      run("/bin/ps", ["-axo", "pid=,args="], PS_TIMEOUT_MS),
    ]);
    return { at, procs: parsePs(stats, args) };
  }
  return { at, procs: process.platform === "linux" ? await readProcFs() : [] };
}

/**
 * Why a pid must never be quit, or null: launchd or init, and BB itself. BB
 * is this process, its parents, and their other children (BB's app, helpers,
 * and host daemon), but not the agents the daemon runs.
 */
export function protection(
  procs: Proc[],
  self: number,
): (pid: number) => string | null {
  const parents = new Map(procs.map((proc) => [proc.pid, proc.ppid]));
  const ancestors = new Set<number>();
  let pid = parents.get(self) ?? 0;
  for (; pid > 1 && !ancestors.has(pid); pid = parents.get(pid) ?? 0) {
    ancestors.add(pid);
  }
  const ours = new Set([self, ...ancestors]);
  for (const proc of procs)
    if (ancestors.has(proc.ppid) || proc.command.includes(GUARD_SCRIPT))
      ours.add(proc.pid);
  return (pid) =>
    pid <= 1 ? "System process" : ours.has(pid) ? "Part of BB" : null;
}

/**
 * Each process's share of one core between two readings. A process missing
 * from the first one started after it, so all its CPU time counts.
 */
export function toProcessInfos(
  before: Reading,
  after: Reading,
  self: number,
): ProcessInfo[] {
  const seconds = (after.at - before.at) / 1000;
  const previous = new Map(
    before.procs.map((proc) => [proc.pid, proc.cpuSeconds]),
  );
  const guard = protection(after.procs, self);
  return after.procs.map(({ pid, name, command, cpuSeconds, memoryBytes }) => {
    const used = cpuSeconds - (previous.get(pid) ?? 0);
    return {
      pid,
      name,
      command,
      cpuPercent: seconds > 0 ? Math.max(0, (100 * used) / seconds) : 0,
      memoryBytes,
      protected: guard(pid) !== null,
    };
  });
}

/** Sends the signal; returns why it failed, or null. Already gone counts as quit. */
function kill(pid: number, force: boolean): string | null {
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return null;
    return code === "EPERM" ? "Not permitted" : (error as Error).message;
  }
}

/** The RPC handlers: the process list, with CPU between readings, and quitting. */
export function createProcessMonitor() {
  let last: Reading | null = null;
  let list: ProcessInfo[] | null = null;
  let pending: Promise<ProcessInfo[]> | null = null;

  async function refresh(): Promise<ProcessInfo[]> {
    if (!last || performance.now() - last.at > STALE_MS) last = await read();
    const wait = last.at + MIN_SPAN_MS - performance.now();
    if (wait > 0) await sleep(wait);
    const next = await read();
    list = toProcessInfos(last, next, process.pid);
    last = next;
    return list;
  }

  return {
    async listProcesses() {
      if (list && last && performance.now() - last.at < FRESH_MS) return list;
      pending ??= refresh().finally(() => {
        pending = null;
      });
      return pending;
    },
    async quitProcesses({ pids, force }) {
      // Only pids in a fresh reading get a signal, so its protection covers them.
      const { procs } = await read();
      const guard = protection(procs, process.pid);
      const alive = new Set(procs.map((proc) => proc.pid));
      const failed: { pid: number; reason: string }[] = [];
      const unique = [...new Set(pids)];
      for (const pid of unique) {
        const reason = guard(pid) ?? (alive.has(pid) ? kill(pid, force) : null);
        if (reason) failed.push({ pid, reason });
      }
      // A refresh that read before the signals would bring the processes back.
      await pending?.catch(() => {});
      list = null;
      return { quit: unique.length - failed.length, failed };
    },
  } satisfies Pick<
    PluginRpcHandlers<typeof rpcContract>,
    "listProcesses" | "quitProcesses"
  >;
}
