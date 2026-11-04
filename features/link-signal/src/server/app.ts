import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { LRUCache } from "lru-cache";
import { config, publicArticleUrl, requestSchema, type Rating } from "../shared.js";

export function createApp(token: string | null, assess: (url: string) => Promise<Rating>) {
  const app = new Hono();
  const cache = new LRUCache<string, Rating>({ max: config.cacheSize, ttl: config.cacheMs });
  const pending = new Map<string, Promise<Rating>>();
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  let windowStart = Date.now();
  let requests = 0;

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const supplied = createHash("sha256").update(c.req.header("Authorization") ?? "").digest();
    if (token !== null && !timingSafeEqual(expected, supplied)) return c.json({ error: "Unauthorized" }, 401);
    await next();
  });
  app.use("*", bodyLimit({ maxSize: 4096 }));
  app.on("POST", ["/score", "/api/score"], async (c) => {
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    const url = publicArticleUrl(parsed.data.url);
    if (!url) return c.json({ rating: "unavailable" });
    const key = url.href;
    const cached = cache.get(key);
    if (cached) return c.json({ rating: cached });
    const existing = pending.get(key);
    if (existing) return c.json({ rating: await existing });
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requests = 0; }
    if (pending.size >= config.concurrency || requests >= config.requestsPerMinute) {
      return c.json({ error: "Busy" }, 429);
    }
    requests++;
    const operation = Promise.resolve().then(() => assess(key)).catch((): Rating => "unavailable");
    pending.set(key, operation);
    try {
      const rating = await operation;
      if (rating !== "unavailable") cache.set(key, rating);
      return c.json({ rating });
    } finally {
      pending.delete(key);
    }
  });
  app.onError(() => Response.json({ error: "Assessment failed" }, { status: 500 }));
  return app;
}
