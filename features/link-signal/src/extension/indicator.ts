import { createElement, SignalHigh } from "lucide";
import { labels, type DisplayState } from "../shared.js";

export function createIndicator(document: Document) {
  const host = document.createElement("span");
  host.className = "zen-link-signal";
  host.style.cssText = "display:inline-flex;position:relative;vertical-align:middle;margin-inline-start:6px;line-height:1";
  host.setAttribute("role", "img");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { --ink: #555b65; --paper: #fff; }
    svg { display: block; color: var(--ink); }
    .tip { display: none; position: absolute; z-index: 2147483647; top: 100%; left: 0;
      margin-top: 6px; padding: 8px 10px; border: 1px solid var(--ink); border-radius: 6px;
      background: var(--paper); color: var(--ink); font: 12px/1.4 system-ui; white-space: nowrap; }
    :host(:hover) .tip, :host([data-focused]) .tip { display: block; }
    @media (prefers-color-scheme: dark) { :host { --ink: #d3d6dd; --paper: #202124; } }
    @media (forced-colors: active) { :host { --ink: CanvasText; --paper: Canvas; } }
  `;
  // SignalHigh has three bars and a connection dot; this meter uses just its bars.
  const icon = createElement(SignalHigh.slice(1), { width: "18", height: "18", viewBox: "4 4 16 18", "aria-hidden": "true" });
  const tooltip = document.createElement("span");
  tooltip.className = "tip";
  tooltip.setAttribute("aria-hidden", "true");
  root.append(style, icon, tooltip);
  function update(state: DisplayState) {
    const active = { human: 1, uncertain: 2, ai: 3, unavailable: 0, loading: 0 }[state];
    [...icon.children].forEach((bar, index) => bar.setAttribute("opacity", index < active ? "1" : "0.2"));
    host.dataset.state = state;
    host.setAttribute("aria-label", labels[state]);
    tooltip.textContent = labels[state];
  }
  update("loading");
  return { host, update };
}
