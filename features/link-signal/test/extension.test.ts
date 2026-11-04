import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { searchResults } from "../src/extension/results.js";

test("selects organic result titles on each supported engine, excluding ads and navigation", () => {
  const fixtures = [
    { page: "https://www.google.com/search?q=garden", html: '<div id="search"><a href="https://news.site/article"><h3>Article</h3></a><div data-text-ad><a href="https://ads.site/ad"><h3>Ad</h3></a></div></div><a href="https://news.site/nav">Navigation</a>' },
    { page: "https://www.bing.com/search?q=garden", html: '<ol id="b_results"><li class="b_algo"><h2><a href="https://news.site/article">Article</a></h2></li><li class="b_ad"><h2><a href="https://ads.site/ad">Ad</a></h2></li></ol>' },
    { page: "https://duckduckgo.com/?q=garden", html: '<a data-testid="result-title-a" href="https://news.site/article">Article</a><div data-testid="ad"><a data-testid="result-title-a" href="https://ads.site/ad">Ad</a></div>' },
  ];
  for (const { page, html } of fixtures) {
    const dom = new JSDOM(html, { url: page });
    assert.deepEqual(searchResults(dom.window.document, page).map(({ url }) => url), ["https://news.site/article"]);
    assert.deepEqual(searchResults(dom.window.document, "https://unrelated.site/search?q=garden"), []);
    dom.window.close();
  }
});

test("unwraps search-engine redirects but preserves unknown links as unrated", () => {
  const target = "https://news.site/article";
  const fixtures = [
    { page: "https://www.google.com/search?q=x", html: `<div id="search"><a href="/url?q=${encodeURIComponent(target)}"><h3>Article</h3></a></div>` },
    { page: "https://www.bing.com/search?q=x", html: `<div id="b_results"><div class="b_algo"><h2><a href="/ck/a?u=a1${Buffer.from(target).toString("base64url")}">Article</a></h2></div></div>` },
    { page: "https://html.duckduckgo.com/html/?q=x", html: `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}">Article</a>` },
  ];
  for (const { page, html } of fixtures) {
    const dom = new JSDOM(html, { url: page });
    assert.equal(searchResults(dom.window.document, page)[0]?.url, target);
    dom.window.close();
  }
  const dom = new JSDOM('<div id="search"><a href="https://news.site/?article=1"><h3>Query article</h3></a></div>');
  assert.equal(searchResults(dom.window.document, "https://www.google.com/search?q=x")[0]?.url, null);
  dom.window.close();
});

test("built content script mounts once, handles recycled results, and removes icons when disabled", async () => {
  const dom = new JSDOM('<div id="search"><a href="https://news.site/first"><h3>Article</h3></a></div>', { url: "https://www.google.com/search?q=test", runScripts: "outside-only" });
  const calls: string[] = [];
  let enabled = true;
  let onSettings = () => {};
  const roots: ShadowRoot[] = [];
  const attachShadow = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function (init) {
    const root = attachShadow.call(this, init);
    roots.push(root);
    return root;
  };
  Object.assign(dom.window, {
    browser: {
      storage: { local: { get: async () => ({ enabled, token: "test-only-access-token-32-characters" }) }, onChanged: { addListener: (callback: () => void) => { onSettings = callback; } } },
      runtime: { sendMessage: async ({ url }: { url: string }) => { calls.push(url); return url.endsWith("first") ? "human" : "ai"; } },
    },
    IntersectionObserver: class {
      constructor(private callback: (entries: { target: Element; isIntersecting: boolean }[]) => void) {}
      observe(target: Element) { this.callback([{ target, isIntersecting: true }]); }
      unobserve() {}
    },
  });
  try {
    dom.window.eval(await readFile("dist/extension/content.js", "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 180));
    const anchor = dom.window.document.querySelector("a")!;
    assert.equal(anchor.querySelectorAll(".zen-link-signal").length, 1);
    assert.equal(anchor.querySelector(".zen-link-signal")?.getAttribute("data-state"), "human");
    assert.deepEqual([...roots[0]!.querySelectorAll("svg path")].map((path) => path.getAttribute("opacity")), ["1", "0.2", "0.2"]);
    anchor.focus();
    assert.ok(anchor.querySelector(".zen-link-signal")?.hasAttribute("data-focused"));
    anchor.href = "https://news.site/second";
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(anchor.querySelectorAll(".zen-link-signal").length, 1);
    assert.equal(anchor.querySelector(".zen-link-signal")?.getAttribute("data-state"), "ai");
    assert.deepEqual(calls, ["https://news.site/first", "https://news.site/second"]);
    enabled = false;
    onSettings();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(anchor.querySelectorAll(".zen-link-signal").length, 0);
    assert.equal(anchor.href, "https://news.site/second");
  } finally {
    dom.window.close();
  }
});
