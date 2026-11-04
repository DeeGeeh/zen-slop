#!/usr/bin/env python3
"""Exercise the packaged browser in a fresh, disposable profile using Marionette."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
from marionette_driver.marionette import Marionette
from marionette_driver.wait import Wait
from marionette_driver import errors


def smoke(bundle, scratch, live_search=False):
    with socket.socket() as connection:
        connection.bind(("127.0.0.1", 0))
        port = connection.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="link-signal-test-", dir=scratch) as directory:
        profile = Path(directory)
        (profile / "user.js").write_text(f'user_pref("marionette.port", {port});\nuser_pref("browser.shell.checkDefaultBrowser", false);\n')
        log_path = scratch / "browser-smoke.log"
        with log_path.open("w") as log:
            process = subprocess.Popen([str(bundle / "link-signal"), "--headless", "--no-remote", "--marionette", "-profile", str(profile), "about:blank"], stdout=log, stderr=log, env={**os.environ, "MOZ_CRASHREPORTER_DISABLE": "1", "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1"})
            client = Marionette(port=port, startup_timeout=45, socket_timeout=45)
            try:
                client.raise_for_port(timeout=45)
                client.start_session({"pageLoadStrategy": "eager"})
                client.timeout.page_load = 30
                client.set_context("chrome")
                state = client.execute_async_script('''
                    const done = arguments[arguments.length - 1];
                    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
                    AddonManager.getAddonByID("link-signal@zen-slop.local").then(addon => done({
                        name: Services.appinfo.name,
                        profile: Services.dirsvc.get("ProfD", Ci.nsIFile).path,
                        active: addon?.isActive,
                        builtin: addon?.isBuiltin,
                        version: addon?.version,
                        updatesDisabled: !Services.policies.isAllowed("appUpdate"),
                        welcomeSeen: Services.prefs.getBoolPref("zen.welcome-screen.seen", false),
                        baseUrl: WebExtensionPolicy.getByID("link-signal@zen-slop.local")?.getURL("")
                    }));
                ''')
                assert state["name"] == "LinkSignal", state
                assert state["profile"] == str(profile), state
                assert state["active"] and state["builtin"], state
                assert state["updatesDisabled"] and state["welcomeSeen"], state
                assert state["baseUrl"].startswith("moz-extension://"), state
                Wait(client, timeout=45).until(lambda driver: driver.execute_script(
                    "return [...Services.wm.getEnumerator('navigator:browser')].some(win => win.gBrowser.browsers.some(browser => browser.currentURI.spec === arguments[0]));",
                    script_args=[state["baseUrl"] + "options.html"],
                ))
                client.set_context("content")
                client.navigate(state["baseUrl"] + "options.html")
                settings = client.execute_script('''return {
                    tokenHidden: document.querySelector("#local-settings").hidden,
                    title: document.querySelector("h1").textContent,
                    hasToggle: Boolean(document.querySelector("#enabled"))
                };''')
                assert settings == {"tokenHidden": True, "title": "Link Signal", "hasToggle": True}, settings
                if live_search:
                    client.execute_async_script("""
                        const done = arguments[arguments.length - 1];
                        const output = document.querySelector('output');
                        const observer = new MutationObserver(() => { observer.disconnect(); done(output.textContent); });
                        observer.observe(output, { childList: true });
                        document.querySelector('#enabled').checked = true;
                        document.querySelector('form').requestSubmit();
                    """)
                    searches = {
                        "google": "https://www.google.com/search?q=photosynthesis",
                        "bing": "https://www.bing.com/search?q=photosynthesis",
                        "duckduckgo": "https://html.duckduckgo.com/html/?q=photosynthesis",
                    }
                    client.navigate(searches[live_search])
                    Wait(client, timeout=15).until(lambda driver: driver.execute_script("return Boolean(document.querySelector('.zen-link-signal'));"))
                    client.execute_script("""
                        const icons = [...document.querySelectorAll('.zen-link-signal')];
                        const target = icons.find(icon => /wikipedia/i.test(icon.closest('a').textContent)) ?? icons[0];
                        target.scrollIntoView({block: 'center'});
                    """)
                    def rated_results(driver):
                        return driver.execute_script("""
                            const icons = [...document.querySelectorAll('.zen-link-signal')];
                            const rated = icons.filter(icon => ['human', 'uncertain', 'ai'].includes(icon.dataset.state));
                            return rated.length ? { count: icons.length, ratings: rated.map(icon => icon.dataset.state), title: document.title } : null;
                        """)
                    try:
                        results = Wait(client, timeout=45, interval=0.3, ignored_exceptions=errors.JavascriptException).until(rated_results)
                    except errors.TimeoutException:
                        print(json.dumps(client.execute_script("""return { url: location.href, title: document.title, icons: [...document.querySelectorAll('.zen-link-signal')].map(icon => icon.dataset.state), text: document.body.innerText.slice(0, 600) };""")))
                        raise
                    assert results["count"] > 0 and results["ratings"], results
                    print(json.dumps({"searchEngine": live_search, "liveResults": results}))
                print(json.dumps({"browser": state["name"], "builtinActive": True, "isolatedProfile": True, "noApiKeySetup": True}))
            finally:
                try:
                    if client.session:
                        client.delete_session()
                finally:
                    if process.poll() is None:
                        process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--live-search", choices=["google", "bing", "duckduckgo"])
    args = parser.parse_args()
    smoke(args.bundle.resolve(), args.scratch.resolve(), args.live_search)
