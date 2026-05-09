import { SEARXNG_URL, REQUEST_TIMEOUT_MS } from "./config.js";

export async function searxngSearch(query: string, maxResults: number, timeRange?: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const endpoint = new URL("/search", SEARXNG_URL);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("format", "json");

  if (timeRange) {
    endpoint.searchParams.set("time_range", timeRange);
  }

  const response = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`SearXNG error: HTTP ${response.status}`);
  }

  const data: any = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];

  return results.slice(0, maxResults).map((r: any) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.content || ""
  }));
}
