# Link Signal

The first feature of the Zen fork: a Lucide three-bar authorship indicator beside organic search-result links.

| Active bars | Meaning |
| --- | --- |
| 1 | Very likely human-written |
| 2 | Not sure |
| 3 | Very likely AI-generated |
| 0 | Loading or not assessed; hover or focus the result link for the status |

These are model estimates, not verified authorship. The current thresholds are provisional and have not been calibrated against a labeled dataset. The model assesses AI generation, not writing quality or factual accuracy.

The installable Linux browser bundles this module and uses a shared hosted service. See [browser packaging](../../browser/README.md). The local workflow below is for feature development only.

## Run the development version

Requires Node 24 and an OpenRouter API key with credits. No Cloudflare account is needed. This module runs in Zen/Firefox 142+ without compiling the Firefox engine. The Linux alpha includes it as a built-in module; public signed releases are not yet available.

```sh
cd features/link-signal
npm ci
npm run check
npm test
npm run package
cp .env.example .env
```

Set `OPENROUTER_API_KEY` in `.env`. Generate `SIGNAL_API_TOKEN` with `openssl rand -hex 32`; use that same token in the extension's settings. The OpenRouter key belongs only in `.env`, never in the extension. Then run:

```sh
npm start
```

In a separate development Zen profile, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/extension/manifest.json`. Open **Link Signal settings** from the extension's toolbar action, enter the local service access token, and enable analysis. Temporary add-ons disappear when the browser exits.

Visit Google.com, Bing, or DuckDuckGo search results. Only visible result links are assessed, up to 30 results per page. Hover the icon or focus its result link for the explanation. No pulse, spinner, or continuous animation is used. Light and dark modes follow the system preference.

The package is generated at `dist/artifacts/link_signal-0.1.0.zip`. It must be signed or integrated into a development browser build before permanent installation; this task does not disable extension signature checks.

## Data flow

The content script identifies organic result titles and sends only eligible destination URLs to the extension background process. The background process calls the hosted service in the packaged browser, or authenticates to the local service in development. That service fetches the public HTML without browser cookies, extracts article text with Mozilla Readability, and sends at most 12,000 characters through OpenRouter's Decisions API (`/api/alpha/decisions`) using `cloudflare/clef-flash`. OpenRouter and the selected inference provider receive the text. It asks separately about AI generation and whether there is sufficient evidence to make a strong judgment.

The socket validates DNS results before connecting; non-public addresses, unsafe redirects, credentials in URLs, alternate ports, non-HTTPS targets, and non-HTML responses are rejected. Reads have size/time limits. Scripts and embedded resources are not executed. Query-bearing links are skipped after known tracking parameters are removed, avoiding accidental transmission of tokens and conflation of different documents.

Successful assessments are cached in bounded memory for 24 hours. Concurrent requests for the same URL share work. Fetch errors, short articles, invalid model responses, and service failures yield **not assessed**, never **not sure**. Rate and concurrency limits bound service work. The development service binds only to `127.0.0.1` and requires its access token. Hosted mode uses edge rate limits instead of a shared client secret. The application does not log URLs or article text. Private browsing is disabled for this extension. Analysis is off until explicitly enabled.

## Source layout

- `src/extension`: result selection, dynamic result handling, icon, settings, and background requests.
- `src/server`: safe article fetching, Clef classification, authenticated service, and cache.
- `api/score.ts`: hosted entry, disabled unless explicitly configured.
- `src/shared.ts`: request/response schemas and operational limits.
- `test`: search fixtures, actual bundled content-script integration, state thresholds, extraction, address validation, authentication, and concurrency checks.

## Limits before release

Search selectors have fixture coverage; search engines can change their markup. The packaged-browser smoke test can check live Google results. Google country domains, PDFs, client-rendered articles, paywalls, private pages, and content-bearing query URLs are not supported. Pages may be inaccessible or change between assessments. OpenRouter notes that the Workers AI provider may truncate text to roughly the first 2,000 tokens, so an assessment may cover only part of the extracted text. No score should be interpreted as proof of authorship.

Before public release, evaluate on held-out human-written, AI-generated, mixed, edited, and translated articles across languages and topics. Measure false positives and abstentions, then calibrate the thresholds. The Linux packaging and isolated preview service are implemented. Signed releases, full branding, a maintained update channel, and wider-platform validation remain release work.

Provider contract: [Clef Flash on OpenRouter](https://openrouter.ai/cloudflare/clef-flash) and [Decisions API HTTP example](https://openrouter.ai/blog/tutorials/how-to-use-jev/). Icon: [Lucide SignalHigh](https://lucide.dev/icons/signal-high), with its connection dot omitted to leave exactly three bars. Lucide's license is included in the extension package.
