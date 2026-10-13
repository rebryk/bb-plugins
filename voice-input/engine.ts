import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
import { promisify } from "node:util";
import type { PluginAiServiceStatus } from "@get-bb/plugin-sdk";
import { RECOGNIZER_SWIFT } from "./recognizer";
import { RecognizerProcess } from "./recognizer-process";

const run = promisify(execFile);

/** Parakeet Ultra's Core ML graphs and vocabulary, zipped. */
const MODEL_URL = "https://d390utbf6y9hg4.cloudfront.net/audio/v3";
const HOME = join(
  homedir(),
  "Library",
  "Application Support",
  "bb-voice-input",
);

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

    async transcribe(audio: File, signal: AbortSignal): Promise<string> {
      const { recognizer, ffmpeg } = await start();
      const dir = await mkdtemp(join(tmpdir(), "bb-voice-input-"));
      try {
        const take = join(dir, "take");
        const wav = join(dir, "take.wav");
        await writeFile(take, Buffer.from(await audio.arrayBuffer()));
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
