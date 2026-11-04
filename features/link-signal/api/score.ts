import { createApp } from "../src/server/app.js";
import { fetchArticle } from "../src/server/article.js";
import { classifyArticle } from "../src/server/classify.js";

const app = createApp(null, async (url) => {
  const text = await fetchArticle(url);
  return text ? classifyArticle(text, process.env.OPENROUTER_API_KEY!) : "unavailable";
});

export default {
  fetch(request: Request) {
    // Enable only after the deployment's edge rate limits have been verified.
    if (process.env.SIGNAL_PUBLIC_API_ENABLED !== "true" || !process.env.OPENROUTER_API_KEY) {
      return Response.json({ error: "Service not available" }, { status: 503 });
    }
    return app.fetch(request);
  },
};
