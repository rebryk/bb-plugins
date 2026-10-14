import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { cleanBb, cleanDev, cleanTrash, deletePaths } from "./clean";
import { rpcContract } from "./contract";
import { CHANGED, type Outcome } from "./shared";
import {
  assignGroups,
  folder,
  snapshot,
  type Context,
  type Disk,
  type Scan,
  type ThreadInfo,
} from "./model";
import { SCANNER_PY } from "./scanner";

const run = promisify(execFile);
/** The data volume holds everything but the sealed system; "/" elsewhere. */
const ROOT = existsSync("/System/Volumes/Data/Users")
  ? "/System/Volumes/Data"
  : "/";
const VOLUMES: Record<string, string> = {
  "/": "macOS system",
  "/System/Volumes/Preboot": "Preboot",
  "/System/Volumes/VM": "VM swap",
  "/System/Volumes/Update": "Update",
  "/Volumes/Recovery": "Recovery",
};
const STALE_DAYS = 7;

/** Sizes from `df`: the container's total and free, and its other volumes. */
async function disk(): Promise<Disk> {
  const { stdout } = await run("df", ["-k"]);
  const rows = stdout
    .split("\n")
    .slice(1)
    .map((line) => line.split(/\s+/))
    .filter((cols) => cols[0]?.startsWith("/dev/") && cols.length >= 6)
    .map((cols) => ({
      mount: cols[cols.length - 1],
      size: +cols[1] * 1024,
      used: +cols[2] * 1024,
      free: +cols[3] * 1024,
    }));
  const main =
    rows.find((r) => r.mount === ROOT) ?? rows.find((r) => r.mount === "/");
  const volumes =
    ROOT === "/"
      ? []
      : rows
          .filter((r) => VOLUMES[r.mount] && r.used > 0)
          .map((r) => ({ label: VOLUMES[r.mount], bytes: r.used }));
  return {
    total: main?.size ?? 0,
    free: main?.free ?? 0,
    used: main?.used ?? 0,
    volumes,
  };
}

/** Whether BB has Full Disk Access: only then may it read the TCC database. */
function fullDiskAccess(): Promise<boolean> {
  return open("/Library/Application Support/com.apple.TCC/TCC.db").then(
    (file) => file.close().then(() => true),
    () => false,
  );
}

/** Run the scanner at low priority and read its result. */
async function scanDisk(): Promise<Scan> {
  const access = await fullDiskAccess();
  const dir = await mkdtemp(join(tmpdir(), "bb-storage-cleaner-"));
  try {
    const script = join(dir, "scan.py");
    const out = join(dir, "scan.json");
    await writeFile(script, SCANNER_PY);
    await new Promise<void>((resolve, reject) => {
      const child = spawn("nice", ["-n", "10", "python3", script, ROOT, out], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on(
        "data",
        (chunk) => (stderr = (stderr + chunk).slice(-2000)),
      );
      // A worker that dies leaves Python's pool waiting forever; stop it.
      const timer = setTimeout(() => child.kill(), 30 * 60_000);
      child.on("error", reject);
      child.on("exit", () => clearTimeout(timer));
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                stderr.trim().split("\n").pop() ||
                  `scanner exited with ${code}`,
              ),
            ),
      );
    });
    const scan = JSON.parse(await readFile(out, "utf8")) as Scan;
    scan.used = (await disk()).used;
    scan.fullDiskAccess = access;
    return scan;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export default function plugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    nightlyScan: {
      type: "boolean",
      label: "Nightly scan",
      description: "00:00 UTC",
      default: true,
    },
    cleanArchivedThreads: {
      type: "boolean",
      label: "Clean stale archived threads",
      description: "Archived 7+ days ago",
      default: false,
    },
    cleanLeftoverWorktrees: {
      type: "boolean",
      label: "Clean leftover worktrees",
      description: "Thread archived or deleted",
      default: false,
    },
    cleanDevCaches: {
      type: "boolean",
      label: "Clean stale dev caches",
      description: "Untouched for 7+ days",
      default: false,
    },
    cleanTrash: {
      type: "boolean",
      label: "Clean Trash",
      description: "Every night",
      default: false,
    },
  });

  // The latest scan lives in the plugin's database, gzipped.
  let migrated = false;
  const db = () => {
    const handle = bb.storage.database();
    if (!migrated)
      bb.storage.migrate(handle, [
        "CREATE TABLE scan (id INTEGER PRIMARY KEY CHECK (id = 1), data BLOB NOT NULL)",
      ]);
    migrated = true;
    return handle;
  };
  let scan: Scan | null | undefined;
  let scanning = false;
  let error: string | null = null;

  const load = () => {
    if (scan === undefined) {
      const row = db().prepare("SELECT data FROM scan WHERE id = 1").get() as
        { data: Buffer } | undefined;
      scan = row
        ? (JSON.parse(gunzipSync(row.data).toString("utf8")) as Scan)
        : null;
    }
    return scan;
  };
  const save = () => {
    if (scan)
      db()
        .prepare("INSERT OR REPLACE INTO scan (id, data) VALUES (1, ?)")
        .run(gzipSync(JSON.stringify(scan)));
  };
  const changed = () => bb.realtime.publish(CHANGED, null);

  /** Threads by id, and the workspaces live threads use. */
  async function threads() {
    const projects = new Map<string, string>();
    for (const project of await bb.sdk.projects.list({ includePersonal: true }))
      projects.set(project.id, project.name);
    const out = new Map<string, ThreadInfo>();
    const inUse: string[] = [];
    for (const archived of [false, true]) {
      for (let offset = 0; ; offset += 200) {
        const page = await bb.sdk.threads.list({
          archived,
          includeHidden: true,
          limit: 200,
          offset,
        });
        for (const t of page) {
          out.set(t.id, {
            title: (t.title ?? t.titleFallback ?? t.id).trim(),
            project: projects.get(t.projectId) ?? "",
            archivedAt: t.archivedAt,
          });
          if (!t.archivedAt && t.environmentPath) inUse.push(t.environmentPath);
        }
        if (page.length < 200) break;
      }
    }
    return { threads: out, inUse };
  }

  async function context(): Promise<Context> {
    const listed = await threads();
    const ctx: Context = {
      home: homedir(),
      bbData: bb.server.experimental_dataDir,
      threads: listed.threads,
      inUse: listed.inUse,
      // Only a definite "not found" counts as gone; any other failure keeps the data.
      exists: (threadId) =>
        bb.sdk.threads.get({ threadId }).then(
          () => true,
          (cause: unknown) =>
            !/not found|404/i.test(
              cause instanceof Error ? cause.message : String(cause),
            ),
        ),
      disk: await disk(),
      now: Math.floor(Date.now() / 1000),
    };
    const current = load();
    if (current) assignGroups(current, ctx);
    return ctx;
  }

  // Scans and cleanups take turns, so none works on a tree another is changing.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }

  /** Scan the disk; false when it failed or one was already running. */
  async function rescan() {
    if (scanning) return false;
    scanning = true;
    error = null;
    changed();
    try {
      scan = await serial(scanDisk);
      save();
      return true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      bb.log.warn(`scan failed: ${error}`);
      return false;
    } finally {
      scanning = false;
      changed();
    }
  }

  /** Run a cleanup on the current scan, then save and tell the page. */
  async function cleanup(
    action: (scan: Scan, ctx: Context) => Promise<Outcome>,
  ): Promise<Outcome> {
    if (scanning) throw new Error("A scan is running. Try again in a minute.");
    return serial(async () => {
      const ctx = await context();
      const current = load();
      if (!current) return { freed: 0, failed: [] };
      const outcome = await action(current, ctx);
      save();
      changed();
      return outcome;
    });
  }

  bb.rpc.register(rpcContract, {
    async storageSnapshot() {
      const access = await fullDiskAccess();
      const current = load();
      // Once BB has Full Disk Access, scan what it couldn't read before. After
      // a failed scan, wait for Rescan, so a failing scan doesn't repeat.
      if (access && current && !current.fullDiskAccess && !error) void rescan();
      return snapshot(current, await context(), {
        scanning,
        error,
        fullDiskAccess: access,
      });
    },
    async storageFolder({ path }) {
      const ctx = await context();
      const current = load();
      const node = current && folder(current, path, ctx);
      return node ? { path, node } : null;
    },
    storageRescan() {
      void rescan();
      return null;
    },
    async storageOpenFullDiskAccess() {
      await run("open", [
        "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
      ]);
      return null;
    },
    storageDelete({ paths }) {
      return cleanup((current, ctx) => deletePaths(paths, current, ctx));
    },
    storageClean({ target }) {
      const all = { threads: true, worktrees: true };
      return cleanup(
        {
          bb: (scan: Scan, ctx: Context) => cleanBb(scan, ctx, all),
          dev: cleanDev,
          trash: cleanTrash,
        }[target],
      );
    },
  });

  // Every hour on the hour; the nightly run is the one at 00:00 UTC.
  bb.background.schedule("storageNightly", "0 * * * *", async () => {
    // Once per UTC day: at 00:00, or at the first hour BB is up after it.
    const today = new Date().toISOString().slice(0, 10);
    const last = await bb.storage.kv.get<string>("lastNightly");
    if (last === today) return;
    await bb.storage.kv.set("lastNightly", today);
    if (last === undefined || last === null) return;
    const on = await settings.get();
    const cleans =
      on.cleanArchivedThreads ||
      on.cleanLeftoverWorktrees ||
      on.cleanDevCaches ||
      on.cleanTrash;
    if (!on.nightlyScan && !cleans) return;
    // Cleaning trusts the ages in the scan, so it needs tonight's.
    if (!(await rescan()) || !cleans) return;
    if (on.cleanArchivedThreads || on.cleanLeftoverWorktrees) {
      await cleanup((current, ctx) =>
        cleanBb(current, ctx, {
          threads: on.cleanArchivedThreads,
          worktrees: on.cleanLeftoverWorktrees,
          staleDays: STALE_DAYS,
        }),
      );
    }
    if (on.cleanDevCaches)
      await cleanup((current, ctx) => cleanDev(current, ctx, STALE_DAYS));
    if (on.cleanTrash)
      await cleanup((current, ctx) => cleanTrash(current, ctx));
  });
}
