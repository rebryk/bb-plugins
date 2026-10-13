import { afterEach, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { PROVIDER } from "./shared";
import { sampleNote } from "./test-fixtures";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]).toString("base64");
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function setup() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "annotate",
    sdk: {
      threads: {
        storageLocation: async ({ threadId }: { threadId: string }) => ({
          hostId: "host-a",
          storageRootPath: `/storage/${threadId}`,
        }),
      },
      files: { write: (async () => ({ outcome: "written" })) as never },
    } as never,
  });
  plugin(bb);
  cleanups.push(() => harness.lifecycle.dispose());
  const provider = harness.registrations.mentionProviders.find(
    (item) => item.id === PROVIDER,
  )!;
  return { harness, resolve: (id: string) => provider.resolve(id) };
}

it("keeps a thread's notes to that thread", async () => {
  const { harness } = setup();
  const note = sampleNote();
  await harness.behavior.callRpc("saveNote", { threadId: "thr_a", note });
  // Another thread can neither read nor overwrite the note.
  await harness.behavior.callRpc("saveNote", {
    threadId: "thr_b",
    note: { ...note, comment: "Taken" },
  });
  expect(
    await harness.behavior.callRpc("getNotes", {
      threadId: "thr_b",
      ids: [note.id],
    }),
  ).toEqual([]);
  await harness.behavior.callRpc("saveNote", {
    threadId: "thr_a",
    note: { ...note, comment: "Edited" },
  });
  expect(
    await harness.behavior.callRpc("getNotes", {
      threadId: "thr_a",
      ids: [note.id, "nmissing1"],
    }),
  ).toEqual([{ ...note, comment: "Edited" }]);
});

it("resolves a pill into the note and its screenshot", async () => {
  const { harness, resolve } = setup();
  const note = sampleNote();
  await harness.behavior.callRpc("saveNote", { threadId: "thr_a", note });
  expect(await resolve(note.id)).toEqual({
    context: expect.stringContaining("> Make this blue"),
  });

  await harness.behavior.callRpc("saveNoteImage", {
    threadId: "thr_a",
    id: note.id,
    base64: JPEG,
  });
  const path = `/storage/thr_a/annotate/${note.id}.jpg`;
  expect(harness.inspection.sdk.callsTo("files.write")).toEqual([
    [
      {
        hostId: "host-a",
        rootPath: "/storage/thr_a",
        path,
        content: JPEG,
        contentEncoding: "base64",
        createParents: true,
      },
    ],
  ]);
  expect(await resolve(note.id)).toMatchObject({
    experimental_images: [{ type: "localImage", path }],
  });
});

it("refuses a screenshot for another thread's note or of another type", async () => {
  const { harness } = setup();
  const note = sampleNote();
  await harness.behavior.callRpc("saveNote", { threadId: "thr_a", note });
  await expect(
    harness.behavior.callRpc("saveNoteImage", {
      threadId: "thr_b",
      id: note.id,
      base64: JPEG,
    }),
  ).rejects.toThrow("no longer exists");
  await expect(
    harness.behavior.callRpc("saveNoteImage", {
      threadId: "thr_a",
      id: note.id,
      base64: Buffer.from("not a jpeg").toString("base64"),
    }),
  ).rejects.toThrow("JPEG");
});

it("forgets a deleted thread's notes", async () => {
  const { harness, resolve } = setup();
  const note = sampleNote();
  await harness.behavior.callRpc("saveNote", { threadId: "thr_a", note });
  const result = await harness.behavior.emitThreadEvent("thread.deleted", {
    thread: makeThreadResponse({ id: "thr_a" }),
  });
  expect(result.errors).toEqual([]);
  expect(() => resolve(note.id)).toThrow("no longer exists");
});
