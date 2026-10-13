// The deletions. Each one updates the scan tree in place, so the page shows the
// new sizes without a rescan.
import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { promisify } from "node:util";
import {
  bbItems,
  cacheFolders,
  canonical,
  clearFolded,
  DAY,
  find,
  isProtected,
  joinPath,
  paths,
  removeFromTree,
  type Context,
  type Scan,
} from "./model";
import type { Outcome } from "./shared";

const run = promisify(execFile);

/** Git worktrees inside a folder: [repository, worktree] from `.git` files. */
async function worktreesIn(dir: string, depth = 3) {
  const found: [string, string][] = [];
  const walk = async (at: string, left: number) => {
    const entries = await readdir(at, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = joinPath(at, entry.name);
      if (entry.name === ".git" && entry.isFile()) {
        const text = await readFile(path, "utf8").catch(() => "");
        const gitdir = /^gitdir:\s*(.+)$/m.exec(text)?.[1].trim() ?? "";
        // Only absolute links to a repository's own worktree list.
        if (gitdir.startsWith("/") && gitdir.includes("/.git/worktrees/")) {
          found.push([gitdir.split("/.git/worktrees/")[0], at]);
        }
      } else if (
        entry.isDirectory() &&
        left > 0 &&
        entry.name !== "node_modules" &&
        entry.name !== ".git"
      ) {
        await walk(path, left - 1);
      }
    }
  };
  await walk(dir, depth);
  return found;
}

/** Delete a file or folder; git forgets each worktree that lived in it. */
export async function removePath(path: string) {
  for (const [repo, worktree] of await worktreesIn(path)) {
    await run("git", [
      "-C",
      repo,
      "worktree",
      "remove",
      "--force",
      "--force",
      worktree,
    ]).catch(() => undefined);
  }
  await rm(path, { recursive: true, force: true, maxRetries: 2 });
}

async function attempt(
  path: string,
  frees: number,
  scan: Scan,
  outcome: Outcome,
) {
  try {
    await removePath(path);
    removeFromTree(scan, path);
    outcome.freed += frees;
  } catch {
    outcome.failed.push(path);
  }
}

/** The explorer's and lists' Delete: only scanned, unprotected paths. */
export async function deletePaths(
  list: string[],
  scan: Scan,
  ctx: Context,
): Promise<Outcome> {
  const outcome: Outcome = { freed: 0, failed: [] };
  for (const raw of list) {
    const path = canonical(raw);
    const node = path && find(scan.tree, path);
    if (!path || !node || isProtected(path, ctx)) outcome.failed.push(raw);
    else await attempt(path, node.u, scan, outcome);
  }
  return outcome;
}

/** Whether a worktree has no uncommitted changes. */
async function committed(path: string) {
  try {
    const { stdout } = await run("git", ["-C", path, "status", "--porcelain"]);
    return stdout.trim() === "";
  } catch {
    return false;
  }
}

/**
 * Storage of archived threads, and worktrees without a live thread. With
 * `staleDays`, only threads archived at least that long ago.
 */
export async function cleanBb(
  scan: Scan,
  ctx: Context,
  what: { threads: boolean; worktrees: boolean; staleDays?: number },
): Promise<Outcome> {
  const outcome: Outcome = { freed: 0, failed: [] };
  const { archived, worktrees } = bbItems(scan, ctx);
  const cutoff =
    what.staleDays === undefined
      ? Infinity
      : (ctx.now - what.staleDays * DAY) * 1000;
  /** BB's folders go only when their thread is archived or surely deleted. */
  const gone = async (path: string) => {
    const id = (path.split("/").pop() ?? "").replace(/-\d+$/, "");
    if (ctx.threads.has(id)) return true;
    return ctx.exists ? !(await ctx.exists(id)) : false;
  };
  if (what.threads) {
    for (const item of archived) {
      const archivedAt =
        ctx.threads.get(item.path.split("/").pop() ?? "")?.archivedAt ?? 0;
      if (archivedAt <= cutoff && (await gone(item.path)))
        await attempt(item.path, item.frees, scan, outcome);
    }
  }
  if (what.worktrees) {
    for (const item of worktrees) {
      const name = item.path.split("/").pop() ?? "";
      // BB's own worktrees lose uncommitted changes; Claude Code's go only clean.
      const ok = name.startsWith("thr_")
        ? await gone(item.path)
        : await committed(item.path);
      if (ok) await attempt(item.path, item.frees, scan, outcome);
    }
  }
  return outcome;
}

/**
 * Whether a folder is a build git ignores, inside a repository that is a
 * project, not the home folder itself.
 */
async function ignoredBuild(path: string, home: string) {
  const dir = path.slice(0, path.lastIndexOf("/")) || "/";
  try {
    const { stdout } = await run("git", [
      "-C",
      dir,
      "rev-parse",
      "--show-toplevel",
    ]);
    const top = stdout.trim();
    const homes = [home, await realpath(home).catch(() => home)];
    if (!homes.some((h) => top.startsWith(`${h}/`))) return false;
    await run("git", ["-C", dir, "check-ignore", "-q", path]);
    return true;
  } catch {
    return false;
  }
}

/** A real folder, not a link to one somewhere else. */
async function isFolder(path: string) {
  return lstat(path).then(
    (s) => s.isDirectory() && !s.isSymbolicLink(),
    () => false,
  );
}

/**
 * Empty the caches in Clean, and delete git-ignored build folders. With
 * `staleDays`, only what nothing touched for that long; an unknown time counts
 * as recent.
 */
export async function cleanDev(
  scan: Scan,
  ctx: Context,
  staleDays?: number,
): Promise<Outcome> {
  const outcome: Outcome = { freed: 0, failed: [] };
  const old = (mtime: number) =>
    staleDays === undefined ||
    (mtime > 0 && ctx.now - mtime >= staleDays * DAY);
  for (const { kind, folders } of cacheFolders(scan, ctx)) {
    if (!kind.inClean) continue;
    for (const { path, node } of folders) {
      if (!(await isFolder(path))) continue;
      if (kind.id === "build") {
        if (old(node.m) && (await ignoredBuild(path, ctx.home)))
          await attempt(path, node.u, scan, outcome);
        continue;
      }
      // A cache folder stays; what is inside it goes.
      const entries = await readdir(path).catch(() => [] as string[]);
      const scanned = new Map((node.k ?? []).map((c) => [c.n, c]));
      for (const name of entries) {
        const child = scanned.get(name);
        const at = joinPath(path, name);
        const mtime =
          child?.m ??
          (await lstat(at).then(
            (s) => s.mtimeMs / 1000,
            () => 0,
          ));
        if (!old(mtime)) continue;
        if (child) await attempt(at, child.u, scan, outcome);
        else
          await rm(at, { recursive: true, force: true }).catch(() =>
            outcome.failed.push(at),
          );
      }
      if (staleDays === undefined) {
        outcome.freed += node.o?.[1] ?? 0;
        clearFolded(scan, path);
      }
    }
  }
  return outcome;
}

/** Empty the Trash: directly with Full Disk Access, else through Finder. */
export async function cleanTrash(scan: Scan, ctx: Context): Promise<Outcome> {
  const outcome: Outcome = { freed: 0, failed: [] };
  const dir = paths(ctx).trash;
  const node = find(scan.tree, dir);
  const before = node && !node.x ? node.u : 0;
  try {
    for (const name of await readdir(dir))
      await attempt(joinPath(dir, name), 0, scan, outcome);
    outcome.freed = outcome.failed.length ? 0 : before;
    clearFolded(scan, dir);
  } catch {
    await run("osascript", [
      "-e",
      'tell application "Finder" to empty trash',
    ]).catch(() => outcome.failed.push(dir));
  }
  return outcome;
}
