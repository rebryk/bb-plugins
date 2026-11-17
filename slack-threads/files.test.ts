import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Attachment, Message } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_FILES,
  fileName,
  removeFiles,
  saveFiles,
  threadFilesDir,
} from "./files";
import { describeMessage } from "./slack";

const message = (id: string, attachments: Attachment[], text = "look") =>
  ({
    id,
    text,
    attachments,
    author: { userName: "ann", isMe: false },
  }) as unknown as Message;

const file = (name: string, body = name, size = body.length): Attachment => ({
  type: "image",
  name,
  size,
  fetchData: vi.fn(async () => Buffer.from(body)),
});

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slack-files-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("fileName", () => {
  it("numbers the file and keeps it inside its directory", () => {
    expect(fileName("chart.png", 0)).toBe("1-chart.png");
    expect(fileName("../../.ssh/id_rsa", 1)).toBe("2-__.._.ssh_id_rsa");
    expect(fileName("..", 2)).toBe("3-_");
    expect(fileName(undefined, 3)).toBe("4-file");
    expect(fileName(`${"a".repeat(200)}.png`, 0)).toHaveLength(102);
  });
});

describe("threadFilesDir", () => {
  it("gives each Slack thread one directory under the root", () => {
    expect(threadFilesDir("/root", "T1:C1:1731.5")).toBe("/root/T1_C1_1731.5");
    expect(threadFilesDir("/root", "T1:../x")).toBe("/root/T1_.._x");
    expect(threadFilesDir("/root", "..")).toBe("/root/_");
  });
});

describe("saveFiles", () => {
  it("saves each file under its message and lists its path", async () => {
    const saved = await saveFiles(dir, [
      message("1731.1", [file("a.png"), file("a.png", "other")]),
      message("1731.2", []),
    ]);
    const path = join(dir, "1731.1", "1-a.png");
    expect(saved.get("1731.1")).toEqual([
      { name: "a.png", path },
      { name: "a.png", path: join(dir, "1731.1", "2-a.png") },
    ]);
    expect(saved.has("1731.2")).toBe(false);
    expect(await readFile(path, "utf8")).toBe("a.png");
    expect(await readdir(join(dir, "1731.1"))).toEqual(["1-a.png", "2-a.png"]);
  });

  it("does not download a saved file again", async () => {
    const first = file("a.png");
    await saveFiles(dir, [message("1731.1", [first])]);
    const again = file("a.png");
    const saved = await saveFiles(dir, [message("1731.1", [again])]);
    expect(again.fetchData).not.toHaveBeenCalled();
    expect(saved.get("1731.1")).toEqual([
      { name: "a.png", path: join(dir, "1731.1", "1-a.png") },
    ]);
  });

  it("keeps a note for a file too large, without a link, or failing", async () => {
    const large = file("big.mov", "x", 40 * 1024 * 1024);
    const failing: Attachment = {
      type: "file",
      name: "doc.pdf",
      fetchData: async () => {
        throw new Error('Ensure your Slack app has the "files:read" scope');
      },
    };
    const saved = await saveFiles(dir, [
      message("1731.1", [large, { type: "file", name: "x.txt" }, failing]),
    ]);
    expect(large.fetchData).not.toHaveBeenCalled();
    expect(saved.get("1731.1")).toEqual([
      {
        name: "big.mov",
        error: "too large (40.0 MB; the limit is 25.0 MB)",
      },
      { name: "x.txt", error: "Slack gave no download link" },
      {
        name: "doc.pdf",
        error: 'Ensure your Slack app has the "files:read" scope',
      },
    ]);
    expect(await readdir(dir)).toEqual([]);
  });

  it(`saves at most ${MAX_FILES} files, the first messages first`, async () => {
    const many = Array.from({ length: MAX_FILES }, (_, i) => file(`${i}.png`));
    const late = file("late.png");
    const saved = await saveFiles(dir, [
      message("1731.1", many),
      message("1731.2", [late]),
    ]);
    expect(saved.get("1731.1")?.every((entry) => "path" in entry)).toBe(true);
    expect(saved.get("1731.2")).toEqual([
      { name: "late.png", error: `over the limit of ${MAX_FILES} files` },
    ]);
    expect(late.fetchData).not.toHaveBeenCalled();
  });
});

describe("removeFiles", () => {
  it("deletes a Slack thread's files and accepts a missing directory", async () => {
    await saveFiles(dir, [message("1731.1", [file("a.png")])]);
    await removeFiles(dir);
    await expect(readdir(dir)).rejects.toThrow();
    await expect(removeFiles(dir)).resolves.toBeUndefined();
  });
});

describe("describeMessage", () => {
  it("lists saved files by path and the others with why", () => {
    expect(
      describeMessage(message("1731.1", [file("a.png"), file("b.png")]), [
        { name: "a.png", path: "/files/1-a.png" },
        { name: "b.png", error: "too large" },
      ]),
    ).toBe(
      [
        "ann: look",
        "  [file] /files/1-a.png",
        "  [file not downloaded] b.png: too large",
      ].join("\n"),
    );
    expect(describeMessage(message("1731.2", [], " hi "))).toBe("ann: hi");
  });
});
