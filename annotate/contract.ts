// The RPC methods between the Browser toolbar control and the server.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { noteIdSchema, noteSchema } from "./shared";

const threadId = z.string().min(1).max(200);
/** A JPEG of up to 4 MB, base64-encoded. */
const MAX_IMAGE_BASE64 = Math.ceil((4 * 1024 * 1024 * 4) / 3);

export const rpcContract = defineRpcContract({
  /** Stores a new note or a note's new comment. */
  saveNote: {
    input: z.object({ threadId, note: noteSchema }),
    output: z.null(),
  },
  /** The thread's stored notes among `ids`, for pills from an earlier window. */
  getNotes: {
    input: z.object({ threadId, ids: z.array(noteIdSchema).max(200) }),
    output: z.array(noteSchema),
  },
  /** A JPEG of the tab's viewport. */
  captureNoteTab: {
    // BB owns the tab id format; it is only compared with the host's tabs.
    input: z.object({ threadId, tabId: z.string().min(1).max(500) }),
    output: z.object({ base64: z.string(), mimeType: z.literal("image/jpeg") }),
  },
  /** Stores the screenshot the agent gets with a note. */
  saveNoteImage: {
    input: z.object({
      threadId,
      id: noteIdSchema,
      base64: z.string().max(MAX_IMAGE_BASE64),
    }),
    output: z.null(),
  },
});
