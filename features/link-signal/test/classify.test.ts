import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyArticle } from "../src/server/classify.js";
import { createApp } from "../src/server/app.js";

test("OpenRouter receives Clef Flash and typed questions; its direct answers drive all three ratings", async (t) => {
  let ai = 0.05;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(input, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-openrouter-key");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(typeof init?.body, "string");
    const payload: unknown = JSON.parse(String(init?.body));
    assert.ok(payload && typeof payload === "object" && "model" in payload && "state" in payload && "questions" in payload);
    assert.equal(payload.model, "cloudflare/clef-flash");
    assert.deepEqual(payload.state, { article: "Article text" });
    assert.ok(payload.questions && typeof payload.questions === "object" && "ai" in payload.questions && "evidence" in payload.questions);
    assert.ok(!String(init?.body).includes("test-openrouter-key"));
    return Response.json({
      model: "cloudflare/clef-flash",
      answers: { ai: { type: "noul", noul: ai }, evidence: { type: "noul", noul: 0.99 } },
    });
  });
  assert.equal(await classifyArticle("Article text", "test-openrouter-key"), "human");
  ai = 0.5;
  assert.equal(await classifyArticle("Article text", "test-openrouter-key"), "uncertain");
  ai = 0.95;
  assert.equal(await classifyArticle("Article text", "test-openrouter-key"), "ai");
});

test("provider errors and malformed decisions remain unassessed through the service", async (t) => {
  const answers = { ai: { type: "noul", noul: 0.99 }, evidence: { type: "noul", noul: 0.99 } };
  const responses = [
    new Response("Unauthorized", { status: 401 }),
    new Response("Rate limited", { status: 429 }),
    new Response("Unavailable", { status: 503 }),
    new Response("not JSON"),
    Response.json({ error: { message: "Upstream failed" } }),
    Response.json({ success: true, result: { answers } }),
    Response.json({ answers: { ai: answers.ai } }),
    Response.json({ answers: { ...answers, ai: { type: "choice", noul: 0.99 } } }),
    Response.json({ answers: { ...answers, ai: { type: "noul", noul: 1.1 } } }),
    Response.json({ answers: { ...answers, ai: { type: "noul", noul: "0.99" } } }),
  ];
  t.mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    if (!response) throw new DOMException("Timed out", "TimeoutError");
    return response;
  });
  const token = "test-local-service-access-token-32-characters";
  const app = createApp(token, () => classifyArticle("Article text", "test-openrouter-key"));
  const attempts = responses.length + 1;
  for (let index = 0; index < attempts; index++) {
    const response = await app.request("http://localhost/score", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "score", url: "https://news.site/article" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { rating: "unavailable" });
  }
});
