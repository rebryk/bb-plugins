import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "chat";

/** The Slack adapter refuses bigger downloads, so they stay in Slack. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Files saved for one prompt at most; the rest stay in Slack. */
export const MAX_FILES = 20;
const NAME_CHARS = 100;
const ERROR_CHARS = 300;

/** A file from a Slack message: saved on disk, or why it was not. */
export type SavedFile =
  { name: string; path: string } | { name: string; error: string };

/** Safe characters only and no leading dots, so a Slack value stays in `dir`. */
const pathPart = (value: string) =>
  value.replace(/[^\w.-]/gu, "_").replace(/^\.+/u, "_");

/** A file name safe on disk, numbered so two files cannot collide. */
export const fileName = (name: string | undefined, index: number) =>
  `${index + 1}-${pathPart(name || "file").slice(-NAME_CHARS)}`;

/** The directory that holds one Slack thread's files. */
export const threadFilesDir = (root: string, slackKey: string) =>
  join(root, pathPart(slackKey));

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Downloads the files of `messages` with the bot token into
 * `dir/<message ts>/`, at most MAX_FILES in the order given: put the messages
 * that matter most first. A file already on disk is not downloaded again.
 * Returns each message's files by message id; failures are kept as notes.
 */
export async function saveFiles(
  dir: string,
  messages: Message[],
): Promise<Map<string, SavedFile[]>> {
  let budget = MAX_FILES;
  const saved = new Map<string, SavedFile[]>();
  await Promise.all(
    messages.map(async (message) => {
      const files = message.attachments.map(async (attachment, index) => {
        const name = attachment.name || "file";
        if ((attachment.size ?? 0) > MAX_FILE_BYTES) {
          return {
            name,
            error: `too large (${megabytes(attachment.size ?? 0)}; the limit is ${megabytes(MAX_FILE_BYTES)})`,
          };
        }
        if (!attachment.fetchData) {
          return { name, error: "Slack gave no download link" };
        }
        if (budget <= 0) {
          return { name, error: `over the limit of ${MAX_FILES} files` };
        }
        budget -= 1;
        const path = join(dir, pathPart(message.id), fileName(name, index));
        try {
          if (!(await exists(path))) {
            const data = await attachment.fetchData();
            await mkdir(join(dir, pathPart(message.id)), { recursive: true });
            // A download cut short never shows up as a whole file.
            await writeFile(
              `${path}.part`,
              data instanceof ArrayBuffer ? new Uint8Array(data) : data,
            );
            await rename(`${path}.part`, path);
          }
          return { name, path };
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          return { name, error: text.slice(0, ERROR_CHARS) };
        }
      });
      if (files.length > 0) saved.set(message.id, await Promise.all(files));
    }),
  );
  return saved;
}

/** Deletes one Slack thread's files; a missing directory is fine. */
export const removeFiles = (dir: string) =>
  rm(dir, { recursive: true, force: true });
