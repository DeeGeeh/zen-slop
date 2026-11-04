import { config, settingsSchema, type Rating } from "../shared.js";
import { createIndicator } from "./indicator.js";
import { searchResults } from "./results.js";

type Entry = ReturnType<typeof createIndicator> & { url: string | null; anchor: HTMLAnchorElement; active: boolean; stop: () => void };
const entries = new Map<HTMLAnchorElement, Entry>();
const queue: Entry[] = [];
let enabled = false;
let running = 0;
let pageUrl = location.href;
let timer: ReturnType<typeof setTimeout>;

async function drain() {
  if (running >= config.concurrency) return;
  const entry = queue.shift();
  if (!entry) return;
  if (!enabled || !entry.active || !entry.anchor.isConnected || !entry.url) return void drain();
  running++;
  try {
    const response: Rating = await browser.runtime.sendMessage({ type: "score", url: entry.url });
    if (entry.active && enabled) entry.update(response ?? "unavailable");
  } catch {
    if (entry.active) entry.update("unavailable");
  } finally {
    running--;
    void drain();
  }
}

const visible = new IntersectionObserver((changes) => {
  for (const change of changes) {
    if (!change.isIntersecting) continue;
    const entry = [...entries.values()].find(({ host }) => host === change.target);
    visible.unobserve(change.target);
    if (entry?.url) { queue.push(entry); void drain(); }
  }
});

function remove(entry: Entry) {
  entry.active = false;
  entry.stop();
  visible.unobserve(entry.host);
  entry.host.remove();
  entries.delete(entry.anchor);
}

function scan() {
  if (!enabled) return;
  if (pageUrl !== location.href) {
    for (const entry of entries.values()) remove(entry);
    queue.length = 0;
    pageUrl = location.href;
  }
  const results = searchResults(document, pageUrl).slice(0, config.maxResults);
  const current = new Set(results.map(({ anchor }) => anchor));
  for (const entry of entries.values()) if (!current.has(entry.anchor)) remove(entry);
  for (const { anchor, title, url } of results) {
    const previous = entries.get(anchor);
    if (previous?.url === url && previous.host.isConnected) continue;
    if (previous) remove(previous);
    const indicator = createIndicator(document);
    const focus = () => indicator.host.setAttribute("data-focused", "");
    const blur = () => indicator.host.removeAttribute("data-focused");
    anchor.addEventListener("focus", focus);
    anchor.addEventListener("blur", blur);
    const entry: Entry = { ...indicator, url, anchor, active: true, stop: () => {
      anchor.removeEventListener("focus", focus);
      anchor.removeEventListener("blur", blur);
    } };
    entries.set(anchor, entry);
    title.append(entry.host);
    if (url) visible.observe(entry.host);
    else entry.update("unavailable");
  }
}

new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(scan, 100);
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

async function loadSettings() {
  const settings = settingsSchema.parse(await browser.storage.local.get(["enabled", "token"]));
  enabled = settings.enabled && (config.hosted || settings.token.length >= 32);
  queue.length = 0;
  for (const entry of entries.values()) remove(entry);
  if (enabled) scan();
}
browser.storage.onChanged.addListener(() => void loadSettings());
void loadSettings();
