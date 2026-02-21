export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source: "duckduckgo-lite" | "wikipedia-opensearch";
}

export interface WebSearchQueryInput {
  query: string;
  limit: number;
  site?: string;
}

export interface WebFetchInput {
  url: string;
  maxChars: number;
}

export interface WebFetchResultItem {
  url: string;
  title: string | null;
  status: number;
  contentType: string | null;
  content: string;
  truncated: boolean;
}

export interface WebSearchClient {
  search(params: WebSearchQueryInput): Promise<WebSearchResultItem[]>;
  fetchPage(params: WebFetchInput): Promise<WebFetchResultItem>;
}

interface CreateWebSearchClientOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  allowPrivateHosts?: boolean;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_USER_AGENT = "jihn/1.0 (+https://jihn.local)";

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, numeric: string) => {
      const code = Number.parseInt(numeric, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function stripTags(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function maybeUnwrapDuckDuckGoRedirect(rawHref: string): string {
  try {
    const url = new URL(rawHref, "https://duckduckgo.com");
    const encoded = url.searchParams.get("uddg");
    if (encoded && encoded.trim().length > 0) {
      return decodeURIComponent(encoded);
    }
    return url.toString();
  } catch {
    return rawHref;
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseDuckDuckGoLiteResults(html: string, limit: number): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = null;

  while ((match = anchorRegex.exec(html)) !== null && results.length < limit) {
    const rawHref = decodeHtmlEntities(match[1] ?? "").trim();
    const title = normalizeWhitespace(decodeHtmlEntities(stripTags(match[2] ?? "")));
    if (rawHref.length === 0 || title.length === 0) {
      continue;
    }

    const url = maybeUnwrapDuckDuckGoRedirect(rawHref);
    if (!isValidHttpUrl(url) || seen.has(url)) {
      continue;
    }
    seen.add(url);

    const rowStart = html.lastIndexOf("<tr", match.index);
    const rowEnd = html.indexOf("</tr>", match.index);
    const row = rowStart >= 0 && rowEnd >= 0 ? html.slice(rowStart, rowEnd + 5) : "";
    const rowText = normalizeWhitespace(decodeHtmlEntities(stripTags(row)));
    const snippet = rowText.replace(title, "").trim();

    results.push({
      title,
      url,
      snippet,
      source: "duckduckgo-lite",
    });
  }

  return results;
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized.endsWith(".local")) {
    return true;
  }
  if (normalized.startsWith("127.")) {
    return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
    const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
    const a = parts[0] ?? -1;
    const b = parts[1] ?? -1;
    if (a === 10 || a === 127) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
  }
  if (normalized.includes(":")) {
    if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) {
      return true;
    }
  }
  return false;
}

function assertRemoteHttpUrl(value: string, allowPrivateHosts: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Field 'url' must be a valid absolute URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Field 'url' protocol must be http or https.");
  }
  if (!allowPrivateHosts && isPrivateHost(url.hostname)) {
    throw new Error("Fetching private/local network hosts is disabled.");
  }
  return url;
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchWithWikipediaFallback(
  fetchFn: typeof fetch,
  query: string,
  limit: number,
): Promise<WebSearchResultItem[]> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "opensearch");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("namespace", "0");
  url.searchParams.set("format", "json");

  const response = await fetchFn(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    return [];
  }
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload) || payload.length < 4) {
    return [];
  }
  const titles = Array.isArray(payload[1]) ? payload[1] : [];
  const snippets = Array.isArray(payload[2]) ? payload[2] : [];
  const urls = Array.isArray(payload[3]) ? payload[3] : [];
  const results: WebSearchResultItem[] = [];
  for (let index = 0; index < Math.min(limit, titles.length, urls.length); index += 1) {
    const title = typeof titles[index] === "string" ? titles[index].trim() : "";
    const link = typeof urls[index] === "string" ? urls[index].trim() : "";
    const snippet = typeof snippets[index] === "string" ? snippets[index].trim() : "";
    if (title.length === 0 || !isValidHttpUrl(link)) {
      continue;
    }
    results.push({
      title,
      url: link,
      snippet,
      source: "wikipedia-opensearch",
    });
  }
  return results;
}

export function createDefaultWebSearchClient(
  options: CreateWebSearchClientOptions = {},
): WebSearchClient {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const allowPrivateHosts = options.allowPrivateHosts ?? false;

  return {
    async search(params) {
      const query = params.site ? `${params.query} site:${params.site}` : params.query;
      const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
      const response = await fetchWithTimeout(
        fetchFn,
        searchUrl,
        {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": userAgent,
          },
        },
        timeoutMs,
      );
      if (!response.ok) {
        throw new Error(`Search request failed with status ${response.status}.`);
      }
      const html = await response.text();
      const parsed = parseDuckDuckGoLiteResults(html, params.limit);
      if (parsed.length > 0) {
        return parsed;
      }
      return searchWithWikipediaFallback(fetchFn, params.query, params.limit);
    },
    async fetchPage(params) {
      const target = assertRemoteHttpUrl(params.url, allowPrivateHosts);
      const response = await fetchWithTimeout(
        fetchFn,
        target.toString(),
        {
          redirect: "follow",
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": userAgent,
          },
        },
        timeoutMs,
      );
      if (!response.ok) {
        throw new Error(`Web fetch failed with status ${response.status}.`);
      }
      const body = await response.text();
      const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title =
        titleMatch && titleMatch[1] ? normalizeWhitespace(decodeHtmlEntities(stripTags(titleMatch[1]))) : null;
      const normalized = normalizeWhitespace(decodeHtmlEntities(stripTags(body)));
      const content = normalized.slice(0, params.maxChars);
      return {
        url: response.url,
        title,
        status: response.status,
        contentType: response.headers.get("content-type"),
        content,
        truncated: normalized.length > content.length,
      };
    },
  };
}
