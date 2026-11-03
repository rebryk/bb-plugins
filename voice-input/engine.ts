import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { PluginAiServiceStatus } from "@get-bb/plugin-sdk";
import { RECOGNIZER_SWIFT } from "./recognizer";
import { RecognizerProcess } from "./recognizer-process";

const run = promisify(execFile);

/** Parakeet Ultra's Core ML graphs and vocabulary, zipped. */
const MODEL_URL = "https://models.shelest.app/models/audio/v3";
const HOME = join(
  homedir(),
  "Library",
  "Application Support",
  "bb-voice-input",
);

/**
 * How long after its stream ends a take waits for BB to ask for its text: BB
 * first uploads the whole recording.
 */
const CLAIM_MS = 60_000;
/** How long BB's request waits for the stream of its take to end. */
const END_MS = 2_000;
/**
 * How far a stream's length may be off its recording's: the two start a few
 * milliseconds apart.
 */
const SLACK_SECONDS = 0.5;
/** A second of streamed samples. */
const BYTES_PER_SECOND = 32_000;
/**
 * Shorter streams are not BB's takes: BB drops takes under a second, and a
 * stream may miss the first moments of one.
 */
const MIN_BYTES = BYTES_PER_SECOND / 2;

/** A take the browser streams while it is spoken. */
export type Stream = {
  /** 16 kHz 16-bit little-endian samples, in order. */
  add(samples: Uint8Array): void;
  /** The take is over: its text gets ready for BB's request. */
  end(): void;
  /** The stream broke off; BB's recording is decoded instead. */
  abandon(): void;
};

type Streamed = {
  bytes: number;
  text: Promise<string> | null;
  ended: Promise<void>;
};

/** How long a recording runs, read from its container without decoding it. */
async function duration(
  ffmpeg: string,
  file: string,
  signal: AbortSignal,
): Promise<number | null> {
  const args = ["-v", "error", "-nostdin", "-progress", "pipe:1", "-i", file];
  const copy = ["-map", "0:a:0", "-c", "copy", "-f", "null", "-"];
  try {
    const { stdout } = await run(ffmpeg, [...args, ...copy], { signal });
    const last = [...stdout.matchAll(/out_time_us=(\d+)/g)].at(-1);
    return last ? Number(last[1]) / 1e6 : null;
  } catch {
    return null;
  }
}

/** `promise`, or the reason `signal` aborts first. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Removes the entries of HOME that start with `prefix`, except `keep`. */
async function sweep(prefix: string, keep?: string): Promise<void> {
  for (const entry of await readdir(HOME))
    if (entry.startsWith(prefix) && entry !== keep)
      await rm(join(HOME, entry), { recursive: true, force: true });
}

/** The first PATH entry, or Homebrew's directories, that holds `name`. */
function find(name: string): string | null {
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  return dirs.map((dir) => join(dir, name)).find(existsSync) ?? null;
}

/** The model folder, downloaded and unpacked on first use. */
async function model(
  progress: (percent: number) => void,
  signal: AbortSignal,
): Promise<string> {
  const folder = join(HOME, "parakeet-ultra");
  if (existsSync(folder)) return folder;
  await mkdir(HOME, { recursive: true });
  // What a download cut short by a quit or a crash left behind.
  await sweep("download-");
  const dir = await mkdtemp(join(HOME, "download-"));
  try {
    const response = await fetch(MODEL_URL, { signal });
    if (!response.ok || !response.body)
      throw new Error(`Speech model download failed: HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length"));
    let done = 0;
    const body = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    body.on("data", (chunk: Buffer) => {
      done += chunk.length;
      if (total) progress(Math.floor((done * 100) / total));
    });
    const zip = join(dir, "model.zip");
    await pipeline(body, createWriteStream(zip), { signal });
    await run("ditto", ["-x", "-k", zip, join(dir, "model")]);
    // Another server generation may have finished first.
    if (!existsSync(folder)) await rename(join(dir, "model"), folder);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return folder;
}

/** The recognizer binary, built with swiftc once per version of its source. */
async function binary(): Promise<string> {
  const hash = createHash("sha256").update(RECOGNIZER_SWIFT).digest("hex");
  const name = `parakeet-asr-${hash.slice(0, 12)}`;
  const path = join(HOME, name);
  if (existsSync(path)) return path;
  await run("xcode-select", ["-p"]).catch(() => {
    throw new Error(
      "Install the Xcode Command Line Tools: xcode-select --install",
    );
  });
  const dir = await mkdtemp(join(HOME, "build-"));
  try {
    await writeFile(join(dir, "main.swift"), RECOGNIZER_SWIFT);
    const output = join(dir, name);
    await run("xcrun", ["swiftc", "-O", "-o", output, join(dir, "main.swift")]);
    await rename(output, path);
    await sweep("parakeet-asr-", name);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return path;
}

/**
 * Gets everything ready on first use and keeps one recognizer running; a
 * recognizer that stops is started again by the next take or status check.
 */
export function createEngine(log: (message: string) => void) {
  let status: PluginAiServiceStatus = { ready: false, message: "Starting" };
  let starting: Promise<{
    recognizer: RecognizerProcess;
    ffmpeg: string;
  }> | null = null;
  let live: RecognizerProcess | null = null;
  const closing = new AbortController();
  /** Streamed takes, oldest first. */
  const streams = new Map<string, Streamed>();

  /**
   * The text of the newest streamed take, if it is the recording BB asks
   * about: BB uploads a recording once it stops, before the next take starts.
   * A take serves one request at most, so a retried recording is decoded.
   */
  async function streamed(
    seconds: Promise<number | null>,
    signal: AbortSignal,
  ): Promise<string | null> {
    const [id, take] = [...streams].at(-1) ?? [];
    if (!id || !take) return null;
    streams.delete(id);
    if (!take.text) await Promise.race([take.ended, delay(END_MS)]);
    const length = take.bytes / BYTES_PER_SECOND;
    const recording = await seconds;
    log(`Streamed ${length.toFixed(1)} s of a ${recording ?? "?"} s recording`);
    if (!take.text) return null;
    if (recording !== null && Math.abs(length - recording) > SLACK_SECONDS)
      return null;
    return abortable(take.text, signal);
  }

  const start = () =>
    (starting ??= (async () => {
      if (process.platform !== "darwin" || process.arch !== "arm64")
        throw new Error("Needs a Mac with Apple silicon");
      const ffmpeg = find("ffmpeg");
      if (!ffmpeg) throw new Error("Install ffmpeg: brew install ffmpeg");
      const folder = await model((percent) => {
        status = {
          ready: false,
          message: `Downloading the speech model: ${percent}%`,
        };
      }, closing.signal);
      status = { ready: false, message: "Building the recognizer" };
      const command = await binary();
      closing.signal.throwIfAborted();
      status = {
        ready: false,
        message: "Opening the model on the Neural Engine",
      };
      const recognizer = new RecognizerProcess(command, [folder]);
      await recognizer.ready;
      live = recognizer;
      void recognizer.exited.then((error) => {
        // A newer start owns the state by now.
        if (live !== recognizer) return;
        live = null;
        starting = null;
        status = { ready: false, message: error.message };
        if (!closing.signal.aborted)
          log(`Recognizer stopped: ${error.message}`);
      });
      status = { ready: true };
      log(`Recognizer ready with ${folder}`);
      return { recognizer, ffmpeg };
    })().catch((error: Error) => {
      starting = null;
      status = { ready: false, message: error.message };
      throw error;
    }));

  return {
    start,

    status(): PluginAiServiceStatus {
      if (!starting && !closing.signal.aborted) start().catch(() => {});
      return status;
    },

    /** A take to stream while it is spoken, or null until a recognizer is up. */
    stream(): Stream | null {
      const recognizer = live;
      if (!recognizer) return null;
      const id = randomUUID();
      let done = () => {};
      const take: Streamed = {
        bytes: 0,
        text: null,
        ended: new Promise((resolve) => (done = resolve)),
      };
      streams.set(id, take);
      let over = false;
      return {
        add(samples) {
          if (over) return;
          take.bytes += samples.length;
          recognizer.append(id, samples);
        },
        end() {
          if (over) return;
          if (take.bytes < MIN_BYTES) return this.abandon();
          over = true;
          take.text = recognizer.finish(id);
          take.text.catch(() => {});
          done();
          setTimeout(() => streams.delete(id), CLAIM_MS).unref();
        },
        abandon() {
          if (over) return;
          over = true;
          recognizer.drop(id);
          streams.delete(id);
          done();
        },
      };
    },

    async transcribe(audio: File, signal: AbortSignal): Promise<string> {
      const { recognizer, ffmpeg } = await start();
      const dir = await mkdtemp(join(tmpdir(), "bb-voice-input-"));
      try {
        const take = join(dir, "take");
        const wav = join(dir, "take.wav");
        await writeFile(take, Buffer.from(await audio.arrayBuffer()));
        try {
          const text = await streamed(duration(ffmpeg, take, signal), signal);
          // Silence, or a stream that heard nothing: the recording may say more.
          if (text) return text;
        } catch (error) {
          if (signal.aborted) throw error;
          log(`Decoding the recording: ${(error as Error).message}`);
        }
        const decode = ["-v", "error", "-nostdin", "-i", take, "-ac", "1"];
        await run(ffmpeg, [...decode, "-c:a", "pcm_f32le", wav], { signal });
        return await recognizer.transcribe(wav, signal);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },

    close(): void {
      closing.abort();
      void starting?.then(({ recognizer }) => recognizer.close(), () => {});
    },
  };
}
