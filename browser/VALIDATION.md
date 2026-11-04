# Linux alpha validation — 2026-11-04

- TypeScript check: passed.
- Feature tests: 17 passed, including the Firefox content-script URL iterator regression.
- Browser packaging tests: 2 passed.
- Extension manifest lint: zero errors, notices, or warnings.
- Hosted preview: public article extraction → OpenRouter Clef Flash → valid rating succeeded. Deployment target is preview; separate project's per-IP and global firewall limits are active.
- Native packaged browser: separate app identity/profile, active built-in feature, upstream updater disabled, automatic first-run setup, and no client API-key setup verified with Marionette.
- Live Bing search: ten result icons mounted; the visible Wikipedia article received an `uncertain` rating through the hosted service. Offscreen results wait until visible; inaccessible articles remain unassessed.
- Browser source and generated feature bundle checked against the local provider key and service token: neither is included.
- Production npm dependency audit: no known vulnerabilities. Development tooling has ten existing advisories in the web-ext dependency tree.

Google challenged the automated test. DuckDuckGo live verification did not complete; selectors for all three engines have fixture tests. The tests run headlessly, not as a graphical usability review. No system package installation or default-browser change was made. No macOS/Windows build, signing, automatic update channel, or classifier calibration is included in this alpha.
