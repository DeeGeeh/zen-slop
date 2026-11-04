import assert from "node:assert/strict";
import { test } from "node:test";
import { config, publicArticleUrl } from "../src/shared.js";
import { extractArticle, isPublicAddress, publicLookup, validateDestination } from "../src/server/article.js";
import { modelResponseSchema, ratingFromEvidence } from "../src/server/classify.js";
import { createApp } from "../src/server/app.js";

test("authorship states require strong evidence and reject invalid probabilities", () => {
  assert.equal(ratingFromEvidence(0.05, 0.95), "human");
  assert.equal(ratingFromEvidence(0.5, 0.95), "uncertain");
  assert.equal(ratingFromEvidence(0.95, 0.95), "ai");
  assert.equal(ratingFromEvidence(0.99, 0.89), "uncertain");
  assert.equal(ratingFromEvidence(0.01, 0.89), "uncertain");
  assert.equal(ratingFromEvidence(0.1, 0.9), "human");
  assert.equal(ratingFromEvidence(0.9, 0.9), "ai");
  for (const invalid of [NaN, Infinity, -1, 1.1]) assert.throws(() => ratingFromEvidence(invalid, 1));
  assert.equal(modelResponseSchema.safeParse({ error: { message: "Provider unavailable" } }).success, false);
  assert.equal(modelResponseSchema.safeParse({ answers: { ai: { type: "noul", noul: "0.9" } } }).success, false);
});

test("public URLs drop tracking without merging content-bearing query variants", () => {
  assert.equal(publicArticleUrl("https://news.site/post?utm_source=search&fbclid=x#section")?.href, "https://news.site/post");
  for (const value of ["https://news.site/?article=1", "https://news.site/?token=secret", "http://news.site/post", "https://user:pass@news.site/post", "https://news.site:8443/post", "file:///etc/passwd", "not a url"]) {
    assert.equal(publicArticleUrl(value), null, value);
  }
});

test("URL sanitizing works without iterable search params in Firefox content scripts", (t) => {
  t.mock.method(URLSearchParams.prototype, "keys", () => { throw new TypeError("Iterator is not iterable"); });
  assert.equal(publicArticleUrl("https://news.site/post?utm_source=x&fbclid=y&utm_campaign=z")?.href, "https://news.site/post");
  assert.equal(publicArticleUrl("https://news.site/post?utm_source=x&article=1"), null);
});

test("private, reserved, and mapped IPs cannot be article destinations", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "192.0.2.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const url of ["https://127.0.0.1", "https://2130706433", "https://0x7f000001", "https://[::ffff:127.0.0.1]", "https://localhost", "https://host.internal", "https://169.254.169.254/latest/meta-data/"]) {
    assert.throws(() => validateDestination(url), url);
  }
  assert.throws(() => validateDestination(new URL("//10.0.0.1/private", "https://news.site/post").href));
});

test("article extraction ignores scripts and refuses insufficient content", () => {
  const paragraph = "This is an article about maintaining a garden. We planted beans near the fence and recorded rainfall each morning. The seedlings grew after the weather warmed. ";
  const html = `<html><head><title>Garden notes</title></head><body><nav>Navigation</nav><article><h1>Garden notes</h1>${Array.from({ length: 12 }, () => `<p>${paragraph.repeat(4)}</p>`).join("")}</article><script>throw new Error('must not execute')</script></body></html>`;
  const text = extractArticle(html, "https://news.site/post");
  assert.ok(text);
  assert.ok(text.includes("recorded rainfall"));
  assert.ok(!text?.includes("must not execute"));
  assert.ok(text.length <= config.maxArticleChars);
  assert.equal(extractArticle("<h1>Sign in</h1><p>Log in to read this article.</p>", "https://news.site/login"), null);
});

test("the socket DNS lookup refuses localhost answers", async () => {
  await new Promise<void>((resolve, reject) => {
    publicLookup("localhost", { all: true }, (error) => {
      try {
        assert.ok(error);
        resolve();
      } catch (failure) { reject(failure); }
    });
  });
});

const token = "test-only-access-token-32-characters";
function request(url = "https://news.site/post", authorization = `Bearer ${token}`) {
  return new Request("http://localhost/score", { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify({ type: "score", url }) });
}

test("service authenticates before fetching and validates the request", async () => {
  let calls = 0;
  const app = createApp(token, async () => { calls++; return "ai"; });
  assert.equal((await app.request(request(undefined, "wrong"))).status, 401);
  assert.equal((await app.request(new Request("http://localhost/score", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{" }))).status, 400);
  const unsupported = await app.request(request("https://news.site/?token=secret"));
  assert.deepEqual(await unsupported.json(), { rating: "unavailable" });
  assert.equal(calls, 0);
});

test("identical concurrent links share one assessment and successful ratings are cached", async () => {
  let calls = 0;
  let finish: (rating: "ai") => void = () => {};
  const done = new Promise<"ai">((resolve) => { finish = resolve; });
  const app = createApp(token, async () => { calls++; return done; });
  const first = app.request(request());
  const second = app.request(request("https://news.site/post?utm_source=test"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  finish("ai");
  assert.deepEqual(await (await first).json(), { rating: "ai" });
  assert.deepEqual(await (await second).json(), { rating: "ai" });
  assert.deepEqual(await (await app.request(request())).json(), { rating: "ai" });
  assert.equal(calls, 1);
});

test("failures stay unavailable and are retried, never cached as uncertainty", async () => {
  let calls = 0;
  const app = createApp(token, async () => { calls++; throw new Error("upstream unavailable"); });
  for (let i = 0; i < 2; i++) assert.deepEqual(await (await app.request(request())).json(), { rating: "unavailable" });
  assert.equal(calls, 2);
});

test("service bounds concurrent work", async () => {
  let finish: (rating: "human") => void = () => {};
  const done = new Promise<"human">((resolve) => { finish = resolve; });
  const app = createApp(token, async () => done);
  const work = Array.from({ length: config.concurrency }, (_, i) => app.request(request(`https://news.site/${i}`)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await app.request(request("https://news.site/overflow"))).status, 429);
  finish("human");
  await Promise.all(work);
});
