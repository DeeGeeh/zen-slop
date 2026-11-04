import assert from "node:assert/strict";
import { test } from "node:test";
import service from "../api/score.js";
import { createApp } from "../src/server/app.js";

test("hosted service fails closed until explicitly enabled and configured", async () => {
  const enabled = process.env.SIGNAL_PUBLIC_API_ENABLED;
  const key = process.env.OPENROUTER_API_KEY;
  try {
    process.env.SIGNAL_PUBLIC_API_ENABLED = "false";
    assert.equal((await service.fetch(new Request("https://signal.example/api/score"))).status, 503);
    process.env.SIGNAL_PUBLIC_API_ENABLED = "true";
    delete process.env.OPENROUTER_API_KEY;
    assert.equal((await service.fetch(new Request("https://signal.example/api/score"))).status, 503);
  } finally {
    if (enabled === undefined) delete process.env.SIGNAL_PUBLIC_API_ENABLED;
    else process.env.SIGNAL_PUBLIC_API_ENABLED = enabled;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = key;
  }
});

test("hosted route works without shipping a provider key or shared token to clients", async () => {
  let calls = 0;
  const app = createApp(null, async () => { calls++; return "uncertain"; });
  const response = await app.request("https://signal.example/api/score", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "score", url: "https://news.site/article" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rating: "uncertain" });
  assert.equal(calls, 1);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
