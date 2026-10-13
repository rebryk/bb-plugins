import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { it } from "vitest";
import { RECOGNIZER_SWIFT } from "./recognizer";

const run = promisify(execFile);
const swift = await run("xcrun", ["--find", "swiftc"]).then(
  () => true,
  () => false,
);

it.skipIf(!swift)("compiles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voice-input-test-"));
  try {
    await writeFile(join(dir, "main.swift"), RECOGNIZER_SWIFT);
    await run("xcrun", ["swiftc", "-typecheck", join(dir, "main.swift")]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
