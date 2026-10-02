import { afterEach, expect, it, vi } from "vitest";
import { installThreadSearch } from "./threads";

const row = (id: string) => ({
  thread: { id }, matches: [{ text: id, highlightRanges: [{ start: 0, end: 3 }] }],
});
const result = (ids: string[], archived: string[] = []) => ({
  active: { results: ids.map(row), total: ids.length },
  archived: { results: archived.map(row), total: archived.length },
});
const endpoint = "https://bb.test/api/v1/threads/search?query=";
let stop: () => void;
afterEach(() => stop());
function setup(fetch: typeof globalThis.fetch) {
  const host = { fetch, location: new URL("https://bb.test/") as unknown as Location };
  stop = installThreadSearch(host);
  return host;
}
const untilAborted: typeof fetch = (_input, options) => new Promise((_resolve, reject) => {
  options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
});

it("searches both layouts, preserves options and merges IDs per lifecycle", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(result(["both", "ru"], ["archive"])))
    .mockResolvedValueOnce(Response.json(result(["both", "en"], ["archive", "other"])));
  const host = setup(fetch);
  const response = await host.fetch(endpoint + "руддщ", { credentials: "same-origin" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get("query")).toBe("hello");
  expect(fetch.mock.calls[1]![1]?.credentials).toBe("same-origin");
  expect(await response.json()).toEqual(result(["both", "ru", "en"], ["archive", "other"]));
  stop();
  expect(host.fetch).toBe(fetch);
});

it("preserves Request headers and respects the result limit", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result(["a", "b", "c"])));
  const host = setup(fetch);
  const request = new Request(endpoint + "hello&limitPerGroup=2", { headers: { "x-test": "keep" } });
  const body = await (await host.fetch(request)).json();
  const second = fetch.mock.calls[1]![0] as Request;
  expect(second.headers.get("x-test")).toBe("keep");
  expect(second.url).toContain(encodeURIComponent("руддщ"));
  expect(body.active.results).toHaveLength(2);
});

it.each(["network", "http", "invalid"])("keeps native results when the alternate fails: %s", async (failure) => {
  const first = Response.json(result(["original"]));
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(first)
    .mockImplementationOnce(async () => {
      if (failure === "network") throw Error("offline");
      return failure === "http" ? new Response("failed", { status: 500 }) : Response.json({ wrong: true });
    });
  expect(await setup(fetch).fetch(endpoint + "hello")).toBe(first);
});

it("leaves other origins, methods, endpoints and non-text queries alone", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
  const host = setup(fetch);
  await host.fetch("https://other.test/api/v1/threads/search?query=hello");
  await host.fetch(endpoint + "hello", { method: "POST" });
  await host.fetch("https://bb.test/api/v1/threads?query=hello");
  await host.fetch(endpoint + "123");
  await host.fetch(endpoint + "h");
  expect(fetch).toHaveBeenCalledTimes(5);
});

it.each([false, true])("disabling cancels the alternate and discards late results (abortable: %s)", async (abortable) => {
  let finish!: (response: Response) => void;
  const first = Response.json(result(["original"]));
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(first)
    .mockImplementationOnce(abortable ? untilAborted : () => new Promise((resolve) => { finish = resolve; }));
  const host = setup(fetch);
  const pending = host.fetch(endpoint + "hello");
  stop();
  if (!abortable) finish(Response.json(result(["other"])));
  expect(fetch.mock.calls[1]![1]!.signal!.aborted).toBe(true);
  expect(await pending).toBe(first);
  expect(host.fetch).toBe(fetch);
});

it("forwards a cancelled query to both requests", async () => {
  const fetch = vi.fn(untilAborted);
  const host = setup(fetch);
  const abort = new AbortController();
  const pending = host.fetch(endpoint + "hello", { signal: abort.signal });
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch.mock.calls[1]![1]!.signal!.aborted).toBe(true);
});
