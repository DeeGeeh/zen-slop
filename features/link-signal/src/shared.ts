import { z } from "zod";

declare const __SIGNAL_SERVICE_URL__: string | undefined;
const serviceUrl = typeof __SIGNAL_SERVICE_URL__ === "undefined" ? undefined : __SIGNAL_SERVICE_URL__;

export const config = {
  endpoint: serviceUrl ?? "http://127.0.0.1:43127/score",
  hosted: Boolean(serviceUrl),
  port: 43127,
  concurrency: 3,
  maxResults: 30,
  cacheSize: 500,
  cacheMs: 24 * 60 * 60 * 1000,
  fetchMs: 8_000,
  modelMs: 12_000,
  maxHtmlBytes: 1_000_000,
  minArticleChars: 800,
  maxArticleChars: 12_000,
  maxRedirects: 3,
  requestsPerMinute: 60,
  decisionsEndpoint: "https://openrouter.ai/api/alpha/decisions",
  model: "cloudflare/clef-flash",
} as const;

export const ratingSchema = z.enum(["human", "uncertain", "ai", "unavailable"]);
export type Rating = z.infer<typeof ratingSchema>;
export type DisplayState = Rating | "loading";
export const scoreSchema = z.object({ rating: ratingSchema });
export const requestSchema = z.object({
  type: z.literal("score"),
  url: z.string().max(2048),
});
export const settingsSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().max(256).default(""),
});

export const labels: Record<DisplayState, string> = {
  human: "Very likely human-written · model estimate",
  uncertain: "Not sure · model estimate",
  ai: "Very likely AI-generated · model estimate",
  unavailable: "Authorship not assessed",
  loading: "Assessing authorship…",
};

export function publicArticleUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)) return null;
    // Firefox content-script wrappers can expose non-iterable search-param iterators.
    const trackingKeys: string[] = [];
    url.searchParams.forEach((_value, key) => {
      if (/^utm_/i.test(key) || ["gclid", "fbclid", "msclkid"].includes(key)) trackingKeys.push(key);
    });
    for (const key of trackingKeys) url.searchParams.delete(key);
    // shortcut: skip query-bearing links, add explicit public query formats when needed.
    if (url.search) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function searchEngine(value: string): "google" | "bing" | "duckduckgo" | null {
  const url = new URL(value);
  if (url.protocol !== "https:") return null;
  if (["www.google.com", "google.com"].includes(url.hostname) && url.pathname === "/search") return "google";
  if (["www.bing.com", "bing.com"].includes(url.hostname) && url.pathname === "/search") return "bing";
  if (["duckduckgo.com", "www.duckduckgo.com", "html.duckduckgo.com"].includes(url.hostname) && url.searchParams.has("q")) return "duckduckgo";
  return null;
}
