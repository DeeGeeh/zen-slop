import { serve } from "@hono/node-server";
import { z } from "zod";
import { config } from "../shared.js";
import { fetchArticle } from "./article.js";
import { classifyArticle } from "./classify.js";
import { createApp } from "./app.js";

const parsed = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  SIGNAL_API_TOKEN: z.string().min(32).max(256),
}).safeParse(process.env);
if (!parsed.success) {
  console.error("Set OPENROUTER_API_KEY and SIGNAL_API_TOKEN (32+ characters) in .env.");
  process.exit(1);
}
const env = parsed.data;
const app = createApp(env.SIGNAL_API_TOKEN, async (url) => {
  const article = await fetchArticle(url);
  return article ? classifyArticle(article, env.OPENROUTER_API_KEY) : "unavailable";
});
serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.port }, () => {
  console.log(`Link Signal listening on http://127.0.0.1:${config.port}`);
});
