import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const GIT_OPTIONS = {
  timeout: 30_000,
  maxBuffer: 256 * 1024,
  encoding: "utf8" as const,
};

/** Keep credentials in the Git transport and out of errors and logs. */
async function git(args: string[], stage: string) {
  try {
    const { stdout } = await exec("git", args, {
      ...GIT_OPTIONS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch {
    throw new Error(`Could not ${stage} the candidate plugin manifest.`);
  }
}

function repositoryUrl(requested: string) {
  if (!requested.startsWith("git:") && !/^https?:\/\//i.test(requested))
    throw new Error("Unsupported plugin source for version verification.");
  const spec = requested.startsWith("git:") ? requested.slice(4) : requested;
  const scheme = /^[a-z][a-z\d+.-]*:\/\//i.exec(spec);
  // An @ in URL credentials or scp's user@host is not a ref separator.
  const authorityEnd = scheme
    ? spec.indexOf("/", scheme[0].length)
    : /^[^/@:]+@[^/:]+:/.exec(spec)?.[0].length;
  const at = spec.lastIndexOf("@");
  const hasRef =
    at > 0 &&
    (authorityEnd === undefined || (authorityEnd >= 0 && at >= authorityEnd));
  const url = hasRef ? spec.slice(0, at) : spec;
  if (!url || /[\0\r\n]/.test(url) || url.startsWith("-"))
    throw new Error("Invalid plugin repository for version verification.");
  if (
    /^(https?|ssh|git|file):\/\//i.test(url) ||
    /^[^/@:]+@[^/:]+:/.test(url) ||
    /^(\/|[a-z]:[\\/])/i.test(url)
  )
    return url;
  if (url.includes(":") || !url.includes("/"))
    throw new Error("Unsupported plugin repository for version verification.");
  return `https://${url}`;
}

function manifestPath(subdirectory: string | undefined) {
  if (subdirectory === undefined) return "package.json";
  if (
    !subdirectory ||
    subdirectory.startsWith("/") ||
    /[\\\0\r\n:]/.test(subdirectory) ||
    subdirectory
      .split("/")
      .some((part) => !part || part === "." || part === ".." || part === ".git")
  )
    throw new Error("Invalid plugin subdirectory for version verification.");
  return `${subdirectory}/package.json`;
}

function version(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error("Candidate plugin manifest has no version.");
  return value.trim();
}

/** Read an exact candidate without checking it out or running package scripts. */
export async function readCandidateVersion(
  source: { requested: string; subdirectory?: string },
  candidate: string,
): Promise<string> {
  if (source.requested.startsWith("npm:")) return version(candidate);
  if (!/^[a-f\d]{40}$/i.test(candidate))
    throw new Error("Invalid candidate commit for version verification.");
  const url = repositoryUrl(source.requested);
  const path = manifestPath(source.subdirectory);
  const directory = await mkdtemp(join(tmpdir(), "bb-auto-update-version-"));
  try {
    await git(["init", "--bare", "--quiet", directory], "prepare");
    await git(
      [
        "-C",
        directory,
        "fetch",
        "--quiet",
        "--depth=1",
        "--no-tags",
        "--",
        url,
        candidate,
      ],
      "fetch",
    );
    const manifest = await git(
      ["-C", directory, "show", `${candidate}:${path}`],
      "read",
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifest);
    } catch {
      throw new Error("Candidate plugin manifest is not valid JSON.");
    }
    return version(
      parsed !== null && typeof parsed === "object" && "version" in parsed
        ? parsed.version
        : undefined,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
