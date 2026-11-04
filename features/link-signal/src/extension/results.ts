import { publicArticleUrl, searchEngine } from "../shared.js";

export function searchResults(document: Document, pageUrl: string) {
  const engine = searchEngine(pageUrl);
  if (!engine) return [];
  const selector = {
    google: "#search a:has(h3)",
    bing: "#b_results .b_algo h2 a",
    duckduckgo: 'a[data-testid="result-title-a"], a.result__a',
  }[engine];
  return [...document.querySelectorAll<HTMLAnchorElement>(selector)].flatMap((anchor) => {
    if (anchor.closest('#tads, #bottomads, [data-text-ad], .b_ad, [data-testid="ad"], .result--ad')) return [];
    try {
      let url = new URL(anchor.getAttribute("href") ?? "", pageUrl);
      if (engine === "google" && ["www.google.com", "google.com"].includes(url.hostname) && url.pathname === "/url") {
        url = new URL(url.searchParams.get("q") ?? url.searchParams.get("url") ?? "");
      }
      if (engine === "duckduckgo" && url.hostname.endsWith("duckduckgo.com") && url.pathname === "/l/") {
        url = new URL(url.searchParams.get("uddg") ?? "");
      }
      if (engine === "bing" && ["www.bing.com", "bing.com"].includes(url.hostname) && url.pathname === "/ck/a") {
        const encoded = url.searchParams.get("u");
        if (!encoded?.startsWith("a1")) return [];
        url = new URL(atob(encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/")));
      }
      if (searchEngine(url.href) || /(^|\.)(google\.com|bing\.com|duckduckgo\.com)$/.test(url.hostname)) return [];
      return [{ anchor, title: anchor.querySelector("h3") ?? anchor, url: publicArticleUrl(url.href)?.href ?? null }];
    } catch {
      return [];
    }
  });
}
