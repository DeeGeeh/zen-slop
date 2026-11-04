import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { config, publicArticleUrl } from "../shared.js";

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === "unicast";
}

// Validate the addresses used by the socket itself, preventing DNS rebinding.
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const first = addresses[0];
    if (!first || addresses.some(({ address }) => !isPublicAddress(address))) {
      return callback(new Error("Non-public destination"), "", 4);
    }
    if (options.all) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
};
const dispatcher = new Agent({ connect: { lookup: publicLookup } });

export function validateDestination(value: string): URL {
  const url = publicArticleUrl(value);
  if (!url) throw new Error("Unsupported destination");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new Error("Non-public destination");
  return url;
}

export function extractArticle(html: string, url: string): string | null {
  const dom = new JSDOM(html, { url });
  try {
    const article = new Readability(dom.window.document).parse();
    const text = article?.textContent?.replace(/\s+/g, " ").trim();
    if (!text || text.length < config.minArticleChars) return null;
    return text.slice(0, config.maxArticleChars);
  } finally {
    dom.window.close();
  }
}

export async function fetchArticle(value: string): Promise<string | null> {
  let url = validateDestination(value);
  const signal = AbortSignal.timeout(config.fetchMs);
  for (let redirects = 0; redirects <= config.maxRedirects; redirects++) {
    const response = await fetch(url, {
      dispatcher,
      redirect: "manual",
      signal,
      headers: { "User-Agent": "ZenLinkSignal/0.1", Accept: "text/html" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) return null;
      url = validateDestination(new URL(location, url).href);
      continue;
    }
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      await response.body?.cancel();
      return null;
    }
    if (!response.body) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let html = "";
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > config.maxHtmlBytes) return null;
        html += decoder.decode(chunk, { stream: true });
      }
      html += decoder.decode();
    } finally {
      await reader.cancel();
    }
    return extractArticle(html, url.href);
  }
  return null;
}
