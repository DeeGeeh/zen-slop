import { LRUCache } from "lru-cache";
import { config, publicArticleUrl, requestSchema, scoreSchema, searchEngine, settingsSchema, type Rating } from "../shared.js";

const cache = new LRUCache<string, Rating>({ max: config.cacheSize, ttl: config.cacheMs });
const pending = new Map<string, Promise<Rating>>();
browser.storage.onChanged.addListener(() => cache.clear());

browser.runtime.onMessage.addListener(async (message: unknown, sender) => {
  const parsed = requestSchema.safeParse(message);
  if (!parsed.success || sender.id !== browser.runtime.id || !sender.tab || sender.tab.incognito || !sender.url || !searchEngine(sender.url)) return "unavailable";
  const settings = settingsSchema.parse(await browser.storage.local.get(["enabled", "token"]));
  if (!settings.enabled || (!config.hosted && settings.token.length < 32)) return "unavailable";
  const url = publicArticleUrl(parsed.data.url);
  if (!url) return "unavailable";
  const key = url.href;
  const cached = cache.get(key);
  if (cached) return cached;
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = (async (): Promise<Rating> => {
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(config.fetchMs + config.modelMs + 2_000),
        headers: { ...(!config.hosted ? { Authorization: `Bearer ${settings.token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ type: "score", url: key }),
      });
      if (!response.ok) return "unavailable";
      const { rating } = scoreSchema.parse(await response.json());
      if (rating !== "unavailable") cache.set(key, rating);
      return rating;
    } catch {
      return "unavailable";
    }
  })();
  pending.set(key, operation);
  try { return await operation; }
  finally { pending.delete(key); }
});

browser.browserAction.onClicked.addListener(() => browser.runtime.openOptionsPage());
browser.runtime.onInstalled.addListener(({ reason }) => {
  if (config.hosted && reason === "install") void browser.runtime.openOptionsPage();
});
