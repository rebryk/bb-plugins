import { alternateQuery } from "./layout";

type Result = { thread: { id: string }; matches: unknown[] };
type Group = { results: Result[]; total: number };
type Search = Record<"active" | "archived", Group>;

function merge(first: Search, second: Search, limit: number): Search {
  const group = (name: keyof Search): Group => {
    const seen = new Set<string>();
    const rows = [...first[name].results, ...second[name].results].filter((row) => {
      // Validate the fields we consume; a changed response keeps native results.
      if (typeof row.thread?.id !== "string" || !Array.isArray(row.matches)) {
        throw new Error("Unsupported thread search result");
      }
      if (seen.has(row.thread.id)) return false;
      seen.add(row.thread.id);
      return true;
    });
    // BB has no pagination here; totals cannot reveal the exact union of capped searches.
    return { results: rows.slice(0, limit), total: rows.length };
  };
  return { active: group("active"), archived: group("archived") };
}

/** BB 0.44.0's search transport. Other requests pass through untouched. */
export function installThreadSearch(host: Pick<Window, "fetch" | "location">) {
  const original = host.fetch;
  const lifetime = new AbortController();
  const wrapped: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    let url: URL;
    try {
      url = new URL(request?.url ?? String(input), host.location.href);
    } catch {
      return original.call(host, input, init);
    }
    const query = url.searchParams.get("query") ?? "";
    const alternate = alternateQuery(query);
    const method = init?.method ?? request?.method ?? "GET";
    if (lifetime.signal.aborted || method.toUpperCase() !== "GET"
      || url.origin !== host.location.origin || url.pathname !== "/api/v1/threads/search"
      || query.trim().length < 2 || query.length > 256 || alternate === null) {
      return original.call(host, input, init);
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    const signals = [lifetime.signal, init?.signal ?? request?.signal];
    for (const signal of signals) signal?.addEventListener("abort", abort, { once: true });
    if (signals.some((signal) => signal?.aborted)) abort();
    const primary = original.call(host, input, init);
    url.searchParams.set("query", alternate);
    const secondary = original.call(host, request ? new Request(url, request) : url,
      { ...init, signal: controller.signal }).catch(() => null);
    try {
      const response = await primary;
      const other = await secondary;
      if (!response.ok || !other?.ok || controller.signal.aborted) return response;
      try {
        const [first, second] = await Promise.all([response.clone().json(), other.json()]);
        if (controller.signal.aborted) return response;
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limitPerGroup")) || 20));
        const body = merge(first, second, limit);
        const headers = new Headers(response.headers);
        for (const name of ["content-length", "content-encoding", "etag"]) headers.delete(name);
        return new Response(JSON.stringify(body), {
          status: response.status, statusText: response.statusText, headers,
        });
      } catch {
        return response;
      }
    } finally {
      abort();
      for (const signal of signals) signal?.removeEventListener("abort", abort);
    }
  };
  host.fetch = wrapped;
  return () => {
    lifetime.abort();
    if (host.fetch === wrapped) host.fetch = original;
  };
}
