# Link Signal for Linux

An installable Zen-based browser alpha with estimated AI-authorship signals beside Google.com, Bing, and DuckDuckGo result links. One bar means very likely human, two means unsure, three means very likely AI. Unassessed results have no active bars.

The browser includes the feature permanently as a built-in module, its own launcher, application identity, desktop entry, and separate profile. Users enable analysis on the first-run Link Signal page. No extension installation, local server, or API key is required. Open the Link Signal toolbar action to change this setting later.

This is a thin distribution of the checksum-pinned Zen runtime in `product.json`; it does not rebuild Gecko. The packager preserves upstream built-ins and addon signature checks. Some upstream pages and artwork still refer to Zen. Browser updates are manual in this alpha so upstream updates cannot overwrite the integration. Do not use this alpha as a daily browser.

## Install or run

The Debian package installs under `/opt/link-signal` and adds **Link Signal** to the application menu. It does not change your default browser or existing Zen installation.

```sh
sudo apt install ./link-signal-browser_0.1.0-alpha1_amd64.deb
```

The portable archive works without installation:

```sh
tar -xf link-signal-0.1.0-alpha1-linux-x86_64.tar.xz
./link-signal/link-signal
```

To remove the Debian package: `sudo apt remove link-signal-browser`. Its separate browser profile is retained.

## Rebuild

Use Linux x86-64, Python 3.12+, Node 24, npm, `zip`, and `dpkg-deb`. Keep downloaded runtimes and output outside this source checkout.

```sh
cd features/link-signal
npm ci
npm run check
npm test
LINK_SIGNAL_ENDPOINT="$(node -p "require('../../browser/product.json').serviceEndpoint")" npm run package
cd ../..
python3 browser/test_package.py
python3 browser/package.py \
  --runtime-archive /path/to/zen.linux-x86_64.tar.xz \
  --output /path/to/new-build-directory
```

Download the runtime URL listed in `product.json`. The packager checks its SHA-256 before extracting it. Output includes the unpacked browser, portable `.tar.xz`, `.deb`, and `SHA256SUMS`. The output directory must not already exist.

For a native browser smoke test, install `marionette_driver==3.7.1` into an isolated Python environment and run:

```sh
python browser/smoke.py --bundle /path/to/new-build-directory/link-signal --scratch /path/to/scratch
```

This launches the packaged binary headlessly with a disposable profile, checks its identity, active built-in feature, disabled upstream updates, and hosted onboarding. `--live-search bing` additionally enables analysis and checks a real search against the deployed service; it makes paid classifier requests. Never point the test at a personal profile.

## Isolated scoring service

The alpha uses the separate Vercel project `link-signal-preview`, with preview-only secrets. Its verified preview endpoint is recorded in `product.json`; update that field after deploying a replacement. `features/link-signal/api/score.ts` exports the hosted handler; `vercel.json` defines its build. The deployment is public so installed browsers can reach it. No provider secret is embedded in the browser.

1. Create and link a new project from `features/link-signal`.
2. Set `OPENROUTER_API_KEY` in that project's **preview** environment.
3. Apply `service-firewall.json` to that new project's firewall, then verify the active configuration: 60 requests/minute per IP and 1,000/hour globally on `/api/score`. The limits are alpha safeguards, not user billing or authentication.
4. Only then set preview `SIGNAL_PUBLIC_API_ENABLED=true`; without it the handler returns 503.
5. Deploy a preview and verify its deployment metadata has no production target. Vercel CLI can promote an initial deployment despite `--target=preview`; the REST `/v13/deployments` API with `target` omitted was used for this alpha.
6. Smoke-test `/api/score` and bake its HTTPS URL into the browser build.

Deploy only service files (`package*.json`, `tsconfig.json`, `vercel.json`, `api`, `src/server`, `src/shared.ts`, and `service`). `.vercelignore` excludes secrets and browser assets. Keep project authentication and provider keys in local ignored files/platform secrets. Do not put them in deployment source or commands.

The API has bounded request bodies, public-address validation at the socket, redirect checks, article size/time limits, per-process concurrency limits, and bounded in-memory caching. Public deployment-wide limits are enforced at Vercel's edge. Disable `SIGNAL_PUBLIC_API_ENABLED` in a new preview deployment and update the browser endpoint to turn off classification.

See [validation results](VALIDATION.md) for the checks performed and their limits.

## Before a wider release

Calibrate the classifier on labeled human, AI, mixed, and edited text; current labels are estimates, not proof. Provide signed releases and an owned browser security-update channel before everyday use. Test graphical behavior, Linux distributions beyond this machine, browser migration/default associations, and accessibility with real users. macOS and Windows are outside this Linux alpha.
