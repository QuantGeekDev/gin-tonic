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
export declare function createDefaultWebSearchClient(options?: CreateWebSearchClientOptions): WebSearchClient;
export {};
//# sourceMappingURL=web-search.d.ts.map