import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import { PROVIDER, formatNote, noteSchema, type Note } from "./shared";

interface Row {
  thread_id: string;
  note: string;
  image_path: string | null;
}

export default function plugin(bb: BbPluginApi): void {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE notes (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, note TEXT NOT NULL, image_path TEXT)",
    "CREATE INDEX notes_thread ON notes(thread_id)",
  ]);
  // A note id belongs to the thread that stored it first.
  const upsert = db.prepare(
    `INSERT INTO notes (id, thread_id, note) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET note = excluded.note
      WHERE thread_id = excluded.thread_id`,
  );
  const select = db.prepare<[string], Row>(
    "SELECT thread_id, note, image_path FROM notes WHERE id = ?",
  );
  const setImage = db.prepare("UPDATE notes SET image_path = ? WHERE id = ?");
  const removeThread = db.prepare("DELETE FROM notes WHERE thread_id = ?");
  const parse = (row: Row): Note => noteSchema.parse(JSON.parse(row.note));
  const owned = (id: string, threadId: string) => {
    const row = select.get(id);
    return row?.thread_id === threadId ? row : undefined;
  };

  bb.rpc.register(rpcContract, {
    saveNote({ threadId, note }) {
      upsert.run(note.id, threadId, JSON.stringify(note));
      return null;
    },
    getNotes({ threadId, ids }) {
      return ids.flatMap((id) => {
        const row = owned(id, threadId);
        return row ? [parse(row)] : [];
      });
    },
    async captureNoteTab({ threadId, tabId }) {
      const browsers = bb.sdk.experimental_desktopBrowsers;
      const hosts = await bb.sdk.hosts.list();
      // The first host with the tab answers; an offline one does not wait.
      const scope = await Promise.any(
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
          throw new Error("No tab");
        }),
      ).catch(() => {
        throw new Error("The Browser tab is no longer open.");
      });
      return browsers.captureTab(scope);
    },
    async saveNoteImage({ threadId, id, base64 }) {
      if (!owned(id, threadId)) throw new Error("This note no longer exists.");
      const bytes = Buffer.from(base64, "base64");
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
        throw new Error("The screenshot must be a JPEG.");
      const { hostId, storageRootPath } = await bb.sdk.threads.storageLocation({
        threadId,
      });
      const path = `${storageRootPath}/annotate/${id}.jpg`;
      await bb.sdk.files.write({
        hostId,
        rootPath: storageRootPath,
        path,
        content: base64,
        contentEncoding: "base64",
        createParents: true,
      });
      setImage.run(path, id);
      return null;
    },
  });

  bb.ui.registerMentionProvider({
    id: PROVIDER,
    label: "Browser notes",
    // Notes come from the Browser's toolbar, never from the @ menu.
    search: () => [],
    resolve(id) {
      const row = select.get(id);
      if (!row)
        throw new Error(
          "A browser note in this message no longer exists. Remove its pill and add the note again.",
        );
      const note = parse(row);
      return {
        context: formatNote(note),
        ...(row.image_path && {
          experimental_images: [
            {
              type: "localImage" as const,
              path: row.image_path,
              context: `Screenshot for browser note ${note.number}: a blue outline and pin ${note.number} mark the element.`,
            },
          ],
        }),
      };
    },
  });

  bb.events.on("thread.deleted", ({ thread }) => {
    removeThread.run(thread.id);
  });
}
