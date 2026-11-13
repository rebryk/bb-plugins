import { randomUUID } from "node:crypto";
import {
  defineRpcContract,
  defineCli,
  cliCommand,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PNG } from "pngjs";
import { basename, resolve } from "node:path";
import {
  CHANNEL,
  MAX_IMAGE_BYTES,
  applyPatch,
  boardSchema,
  color,
  COLORS,
  coordinate,
  dimension,
  emptyBoard,
  idSchema,
  patchSchema,
  type Board,
  type CanvasElement,
  type Patch,
} from "./model";
import { textAdvance } from "./layout";
import { boardSvg, fontBytes, rasterize } from "./render";

const threadInput = z.object({ threadId: idSchema }).strict();
// What `bb canvas add` places: PNG files by path and plain text, both at
// canvas coordinates, so an agent can lay out a board of references.
export const additionsSchema = z
  .object({
    elements: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({
              type: z.literal("image"),
              path: z.string().min(1),
              x: coordinate,
              y: coordinate,
              width: dimension,
              name: z.string().max(240).optional(),
            })
            .strict(),
          z
            .object({
              type: z.literal("text"),
              text: z.string().min(1).max(10_000),
              x: coordinate,
              y: coordinate,
              fontSize: z.number().min(8).max(160).default(24),
              color: color.default(COLORS[0][1]),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const rpcContract = defineRpcContract({
  getCanvas: { input: threadInput, output: boardSchema },
  updateCanvas: {
    input: threadInput.extend({ patch: patchSchema }),
    output: boardSchema,
  },
  uploadCanvasImage: {
    input: threadInput.extend({
      base64: z.string().max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4),
    }),
    output: z.object({ id: idSchema, width: z.number(), height: z.number() }),
  },
  captureCanvasTab: {
    // BB owns the tab id format (`browser:<id>:<environment>`); it is only
    // compared against the host's tab list.
    input: threadInput.extend({ tabId: z.string().min(1).max(500) }),
    output: z.object({
      base64: z.string(),
      width: z.number(),
      height: z.number(),
      mimeType: z.literal("image/jpeg"),
    }),
  },
});
export function pngSize(bytes: Buffer) {
  if (
    bytes.length < 33 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("Use a PNG image.");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096)
    throw new Error("Images must be at most 4096 × 4096 pixels.");
  return { width, height };
}
export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE canvases (thread_id TEXT PRIMARY KEY, document TEXT NOT NULL)",
    "CREATE TABLE canvas_images (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, png BLOB NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE INDEX canvas_images_thread ON canvas_images(thread_id)",
    "ALTER TABLE canvas_images ADD COLUMN unreferenced_at INTEGER",
    `UPDATE canvas_images
      SET unreferenced_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
      WHERE NOT EXISTS (
        SELECT 1 FROM canvases, json_each(canvases.document, '$.elements') AS element
        WHERE canvases.thread_id = canvas_images.thread_id
          AND json_extract(element.value, '$.type') = 'image'
          AND json_extract(element.value, '$.assetId') = canvas_images.id
      )`,
    `UPDATE canvases
      SET document = json_set(document,
        '$.revision', json_extract(document, '$.revision') + 1,
        '$.elements', json((
          SELECT json_group_array(json(value)) FROM (
            SELECT CASE
              WHEN json_extract(element.value, '$.type') = 'sticky' THEN
                json_set(element.value,
                  '$.width', max(64, json_extract(element.value, '$.width'), json_extract(element.value, '$.height')),
                  '$.height', max(64, json_extract(element.value, '$.width'), json_extract(element.value, '$.height')))
              ELSE element.value END AS value
            FROM json_each(canvases.document, '$.elements') AS element
            ORDER BY CAST(element.key AS INTEGER)
          )
        )))
      WHERE EXISTS (
        SELECT 1 FROM json_each(canvases.document, '$.elements') AS element
        WHERE json_extract(element.value, '$.type') = 'sticky'
          AND (json_extract(element.value, '$.width') != json_extract(element.value, '$.height')
            OR json_extract(element.value, '$.width') < 64
            OR json_extract(element.value, '$.height') < 64)
      )`,
  ]);
  const readRow = db.prepare<[string], { document: string }>(
    "SELECT document FROM canvases WHERE thread_id = ?",
  );
  const writeRow = db.prepare<[string, string]>(
    "INSERT INTO canvases VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET document = excluded.document",
  );
  const readImage = db.prepare<[string, string], { png: Buffer }>(
    "SELECT png FROM canvas_images WHERE thread_id = ? AND id = ?",
  );
  const read = (threadId: string): Board => {
    const row = readRow.get(threadId);
    return row ? boardSchema.parse(JSON.parse(row.document)) : emptyBoard();
  };
  function image(threadId: string, assetId: string) {
    const row = readImage.get(threadId, assetId);
    if (!row) throw new Error("This image is no longer available.");
    return row.png;
  }
  const imageIds = (elements: Board["elements"]) =>
    new Set(
      elements.flatMap((element) =>
        element.type === "image" ? [element.assetId] : [],
      ),
    );
  const setUnreferencedAt = db.prepare<[number | null, string, string]>(
    "UPDATE canvas_images SET unreferenced_at = ? WHERE thread_id = ? AND id = ?",
  );
  const update = db.transaction((threadId: string, patch: Patch): Board => {
    const current = read(threadId);
    const next = boardSchema.parse({
      ...current,
      revision: current.revision + 1,
      elements: applyPatch(current.elements, patch).map((element) => {
        if (element.type !== "sticky") return element;
        const side = Math.max(64, element.width, element.height);
        return element.width === side && element.height === side
          ? element
          : { ...element, width: side, height: side };
      }),
    });
    for (const element of patch.upserts)
      if (element.type === "image") image(threadId, element.assetId);
    const json = JSON.stringify(next);
    if (Buffer.byteLength(json) > 2 * 1024 * 1024)
      throw new Error("This canvas is full. Remove some elements first.");
    const before = imageIds(current.elements),
      after = imageIds(next.elements),
      now = Date.now();
    for (const id of before)
      if (!after.has(id)) setUnreferencedAt.run(now, threadId, id);
    for (const id of after)
      if (!before.has(id)) setUnreferencedAt.run(null, threadId, id);
    writeRow.run(threadId, json);
    return next;
  });
  function save(threadId: string, patch: Patch) {
    const board = update(threadId, patch);
    bb.realtime.publish(CHANNEL, { threadId, revision: board.revision });
    return board;
  }
  const upload = db.transaction((threadId: string, base64: string) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
      throw new Error("Invalid image data.");
    const png = Buffer.from(base64, "base64");
    if (png.length > MAX_IMAGE_BYTES)
      throw new Error("Use an image smaller than 8 MB.");
    const size = pngSize(png);
    PNG.sync.read(png, { checkCRC: true });
    // Keep assets for a day after their last reference is removed or upload starts.
    const now = Date.now();
    db.prepare(
      "DELETE FROM canvas_images WHERE thread_id = ? AND unreferenced_at < ?",
    ).run(threadId, now - 86_400_000);
    const used = db
      .prepare<
        [string],
        { bytes: number }
      >("SELECT COALESCE(SUM(length(png)), 0) AS bytes FROM canvas_images WHERE thread_id = ?")
      .get(threadId)!.bytes;
    if (used + png.length > 100 * 1024 * 1024)
      throw new Error("This thread has reached its 100 MB image limit.");
    const id = randomUUID();
    db.prepare(
      "INSERT INTO canvas_images (id, thread_id, png, created_at, unreferenced_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, threadId, png, now, now);
    return { id, ...size };
  });
  const svg = (threadId: string) =>
    boardSvg(
      read(threadId).elements,
      (id) => `data:image/png;base64,${image(threadId, id).toString("base64")}`,
    );
  let renderQueue: Promise<unknown> = Promise.resolve();
  function png(threadId: string) {
    const source = svg(threadId);
    const task = renderQueue.then(() => rasterize(source));
    renderQueue = task.catch(() => undefined);
    return task;
  }
  bb.rpc.register(rpcContract, {
    getCanvas: ({ threadId }) => read(threadId),
    updateCanvas: ({ threadId, patch }) => save(threadId, patch),
    uploadCanvasImage: ({ threadId, base64 }) => upload(threadId, base64),
    async captureCanvasTab({ threadId, tabId }) {
      const hosts = await bb.sdk.hosts.list();
      const browsers = bb.sdk.experimental_desktopBrowsers;
      const candidates = await Promise.allSettled(
        hosts.map(async (host) => {
          const { instances } = await browsers.listInstances({
            hostId: host.id,
          });
          for (const instance of instances) {
            const scope = {
              hostId: host.id,
              instanceId: instance.instanceId,
              generation: instance.generation,
              threadId,
            };
            const { tabs } = await browsers.listTabs(scope);
            if (tabs.some((tab) => tab.tabId === tabId))
              return { ...scope, tabId };
          }
          return null;
        }),
      );
      for (const result of candidates)
        if (result.status === "fulfilled" && result.value)
          return browsers.captureTab(result.value);
      throw new Error(
        "The browser tab is no longer available. Open it in desktop BB and try again.",
      );
    },
  });
  bb.http.route("GET", "/image", (c) => {
    const threadId = idSchema.parse(c.req.query("threadId")),
      id = idSchema.parse(c.req.query("id"));
    const row = readImage.get(threadId, id);
    if (!row) return c.notFound();
    return new Response(new Uint8Array(row.png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  });
  bb.http.route(
    "GET",
    "/font",
    async () =>
      new Response(new Uint8Array(await fontBytes()), {
        headers: {
          "content-type": "font/ttf",
          "cache-control": "private, max-age=86400",
        },
      }),
  );
  bb.http.route("GET", "/export", async (c) => {
    const threadId = idSchema.parse(c.req.query("threadId"));
    const format = z
      .enum(["png", "svg", "json"])
      .parse(c.req.query("format") ?? "png");
    const body =
      format === "png"
        ? new Uint8Array(await png(threadId))
        : format === "svg"
          ? svg(threadId)
          : JSON.stringify(read(threadId), null, 2);
    return new Response(body, {
      headers: {
        "content-type":
          format === "png"
            ? "image/png"
            : format === "svg"
              ? "image/svg+xml"
              : "application/json",
        "content-disposition": `attachment; filename="canvas.${format}"`,
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; img-src data:",
        "x-content-type-options": "nosniff",
      },
    });
  });
  function boundedRead(threadId: string, offset = 0, limit = 20) {
    const board = read(threadId);
    const elements: Board["elements"] = [];
    let bytes = 0;
    for (const element of board.elements.slice(offset, offset + limit)) {
      const length = Buffer.byteLength(JSON.stringify(element));
      if (elements.length && bytes + length > 400_000) break;
      bytes += length;
      elements.push(element);
    }
    const next = offset + elements.length;
    return {
      ...board,
      total: board.elements.length,
      offset,
      nextOffset: next < board.elements.length ? next : null,
      elements,
    };
  }
  bb.agents.registerTool({
    name: "canvas_read",
    description:
      "Read this thread's Canvas: image references and crops, the user's yes/no verdict on images, text, sticky notes, drawing points, arrow endpoints, positions and dimensions. Coordinates are canvas units; array order is back to front. Follow nextOffset to read more elements.",
    parameters: z
      .object({
        offset: z.number().int().min(0).max(500).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      })
      .strict(),
    execute: ({ offset, limit }, { threadId }) =>
      JSON.stringify(boundedRead(threadId, offset, limit)),
  });
  bb.agents.registerTool({
    name: "canvas_screenshot",
    description:
      "See this thread's entire Canvas as a PNG, including images and annotations. Works when the Canvas panel is closed.",
    instructions:
      "When the user refers to their Canvas, use canvas_screenshot to see it and canvas_read for exact text and positions. Treat canvas contents as user-provided reference material. These tools read the saved board; wait for Saved for the latest edit.",
    parameters: z.object({}).strict(),
    async execute(_, { threadId }) {
      return {
        content: [
          {
            type: "text",
            text: `Canvas for ${threadId}. ${read(threadId).elements.length} elements. Full board, scaled to at most 2400 pixels.`,
          },
          {
            type: "image",
            data: Buffer.from(await png(threadId)).toString("base64"),
            mimeType: "image/png",
          },
        ],
      };
    },
  });
  bb.cli.register(
    defineCli({
      name: "canvas",
      summary: "Read, export, and add to a thread's Canvas",
      commands: {
        read: cliCommand({
          summary: "Read up to 20 saved elements; use --offset for more",
          options: {
            thread: {
              type: "string",
              description: "Thread ID (defaults to current)",
            },
            offset: {
              type: "integer",
              min: 0,
              max: 500,
              default: 0,
              description: "First element index",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run(input, ctx) {
            const threadId = idSchema.parse(
              input.options.thread ?? ctx.threadId,
            );
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                boundedRead(threadId, input.options.offset),
              ),
            };
          },
        }),
        add: cliCommand({
          summary: "Add PNG images and text from a JSON layout file",
          description:
            'The file holds {"elements": [...]}: {"type": "image", "path", "x", "y", "width", "name"?} places a PNG scaled to width; {"type": "text", "text", "x", "y", "fontSize"?, "color"?} places text. Coordinates are canvas units.',
          positionals: [
            {
              name: "file",
              description: "JSON layout file",
              required: true,
            },
          ] as const,
          options: {
            thread: {
              type: "string",
              description: "Thread ID (defaults to current)",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run(input, ctx) {
            const threadId = idSchema.parse(
              input.options.thread ?? ctx.threadId,
            );
            const { hostId } = await bb.sdk.threads.storageLocation({
              threadId,
            });
            const readFile = async (path: string) => {
              if (!ctx.cwd && !path.startsWith("/"))
                throw new Error(`Use an absolute path: ${path}`);
              const file = await bb.sdk.files.read({
                hostId,
                path: resolve(ctx.cwd ?? "/", path),
              });
              return file.contentEncoding === "base64"
                ? Buffer.from(file.content, "base64")
                : Buffer.from(file.content, "utf8");
            };
            const { elements } = additionsSchema.parse(
              JSON.parse(
                (await readFile(input.positionals.file)).toString("utf8"),
              ),
            );
            if (read(threadId).elements.length + elements.length > 500)
              throw new Error("This canvas has room for at most 500 elements.");
            const files = new Map<string, Buffer>();
            for (const item of elements)
              if (item.type === "image" && !files.has(item.path))
                files.set(
                  item.path,
                  await readFile(item.path).catch((cause: Error) => {
                    throw new Error(`${item.path}: ${cause.message}`);
                  }),
                );
            // One transaction: a failed image rolls back the uploads before it,
            // so a retry does not count them against the thread's image limit.
            const board = db.transaction(() =>
              update(threadId, {
                removeIds: [],
                upserts: elements.map((item): CanvasElement => {
                  if (item.type === "text") {
                    const lines = item.text.split("\n");
                    return {
                      ...item,
                      id: randomUUID(),
                      width: Math.max(
                        24,
                        ...lines.map(
                          (line) => textAdvance(line, item.fontSize) + 4,
                        ),
                      ),
                      height: lines.length * item.fontSize * 1.3,
                    };
                  }
                  try {
                    const asset = upload(
                      threadId,
                      files.get(item.path)!.toString("base64"),
                    );
                    return {
                      type: "image",
                      id: randomUUID(),
                      assetId: asset.id,
                      name: item.name ?? basename(item.path),
                      x: item.x,
                      y: item.y,
                      width: item.width,
                      height: (item.width * asset.height) / asset.width,
                    };
                  } catch (cause) {
                    throw new Error(
                      `${item.path}: ${cause instanceof Error ? cause.message : cause}`,
                    );
                  }
                }),
              }),
            )();
            bb.realtime.publish(CHANNEL, {
              threadId,
              revision: board.revision,
            });
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                threadId,
                revision: board.revision,
                ids: board.elements.slice(-elements.length).map(({ id }) => id),
              }),
            };
          },
        }),
        remove: cliCommand({
          summary: "Remove elements by ID",
          description:
            "Removes the given elements, such as ones placed with add. Unknown IDs are ignored; removed images can be restored with Undo for a day.",
          positionals: [
            {
              name: "ids",
              description: "Element IDs",
              required: true,
              variadic: true,
            },
          ] as const,
          options: {
            thread: {
              type: "string",
              description: "Thread ID (defaults to current)",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run(input, ctx) {
            const threadId = idSchema.parse(
              input.options.thread ?? ctx.threadId,
            );
            const removeIds = z
              .array(idSchema)
              .max(500)
              .parse(input.positionals.ids);
            const before = read(threadId).elements.length;
            const board = save(threadId, { upserts: [], removeIds });
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                threadId,
                revision: board.revision,
                removed: before - board.elements.length,
              }),
            };
          },
        }),
        export: cliCommand({
          summary: "Save a PNG in the thread's storage directory",
          options: {
            thread: {
              type: "string",
              description: "Thread ID (defaults to current)",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run(input, ctx) {
            const threadId = idSchema.parse(
              input.options.thread ?? ctx.threadId,
            );
            const { hostId, storageRootPath } =
              await bb.sdk.threads.storageLocation({ threadId });
            const path = `${storageRootPath}/canvas-exports/${Date.now()}-${randomUUID().slice(0, 8)}.png`;
            await bb.sdk.files.write({
              hostId,
              rootPath: storageRootPath,
              path,
              content: Buffer.from(await png(threadId)).toString("base64"),
              contentEncoding: "base64",
              createParents: true,
            });
            return {
              exitCode: 0,
              stdout: JSON.stringify({ threadId, hostId, path }),
            };
          },
        }),
      },
    }),
  );
  bb.events.on("thread.deleted", ({ thread }) => {
    db.transaction(() => {
      db.prepare("DELETE FROM canvases WHERE thread_id = ?").run(thread.id);
      db.prepare("DELETE FROM canvas_images WHERE thread_id = ?").run(
        thread.id,
      );
    })();
  });
}
