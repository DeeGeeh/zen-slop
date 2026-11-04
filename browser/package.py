#!/usr/bin/env python3
"""Build a separate Linux browser from a verified Zen runtime and our built-in module."""
import argparse
import configparser
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = json.loads((ROOT / "browser/product.json").read_text())
BUILTINS = "chrome/browser/content/browser/built_in_addons.json"
ADDON_ROOT = "chrome/browser/builtin-addons/link-signal/"


def patch_omni(source, destination, extension):
    manifest = json.loads((extension / "manifest.json").read_text())
    with ZipFile(source) as original, ZipFile(destination, "w", ZIP_DEFLATED) as output:
        if original.testzip() is not None:
            raise ValueError("Upstream archive failed CRC validation")
        if BUILTINS not in original.namelist():
            raise ValueError("Unsupported Zen runtime: built-in registration missing")
        for entry in original.infolist():
            data = original.read(entry.filename)
            if entry.filename == BUILTINS:
                addons = json.loads(data)
                addons["builtins"] = [addon for addon in addons["builtins"] if addon["addon_id"] != manifest["browser_specific_settings"]["gecko"]["id"]]
                addons["builtins"].append({
                    "addon_id": manifest["browser_specific_settings"]["gecko"]["id"],
                    "addon_version": manifest["version"],
                    "res_url": "resource://builtin-addons/link-signal/",
                })
                data = json.dumps(addons).encode()
            elif entry.filename.endswith("/branding/brand.ftl"):
                data = ("\n".join(f"{key} = {PRODUCT['name']}" for key in ["-brand-shorter-name", "-brand-short-name", "-brand-full-name", "-brand-product-name", "-vendor-short-name"]) + '\ntrademarkInfo = { " " }\n').encode()
            elif entry.filename.endswith("/branding/brand.properties"):
                data = ("\n".join(f"{key}={PRODUCT['name']}" for key in ["brandShorterName", "brandShortName", "brandFullName", "vendorShortName"]) + "\n").encode()
            if entry.filename.startswith(ADDON_ROOT):
                continue
            output.writestr(entry, data)
        for file in sorted(extension.iterdir()):
            if file.is_file():
                output.write(file, ADDON_ROOT + file.name)
    with ZipFile(destination) as output:
        if output.testzip() is not None:
            raise ValueError("Packaged browser archive failed CRC validation")


def build(runtime_archive, extension, output):
    service = json.loads((extension / "service.json").read_text())
    if not isinstance(service.get("endpoint"), str) or not service["endpoint"].startswith("https://"):
        raise ValueError("Build the extension with LINK_SIGNAL_ENDPOINT before packaging the browser")
    if hashlib.file_digest(runtime_archive.open("rb"), "sha256").hexdigest() != PRODUCT["runtimeSha256"]:
        raise ValueError("Zen runtime checksum does not match the pinned release")
    output.mkdir(parents=True, exist_ok=False)
    bundle = output / PRODUCT["binary"]
    bundle.mkdir()
    with tarfile.open(runtime_archive) as archive:
        archive.extractall(bundle, filter="data")
    runtime = bundle / "zen"
    normalized = output / "omni-normalized.zip"
    # Firefox's optimized ZIP layout is repaired by zip, then every entry is CRC-checked.
    repair = subprocess.run(["zip", "-FF", str(runtime / "browser/omni.ja"), "--out", str(normalized)], stdin=subprocess.DEVNULL, capture_output=True, timeout=120)
    if repair.returncode:
        raise RuntimeError("Could not normalize the runtime archive")
    patched = output / "omni-patched.zip"
    patch_omni(normalized, patched, extension)
    shutil.move(patched, runtime / "browser/omni.ja")
    normalized.unlink()

    app = configparser.ConfigParser()
    app.optionxform = str
    app.read(runtime / "application.ini")
    app["App"].update({"Name": PRODUCT["appName"], "RemotingName": PRODUCT["binary"], "Profile": PRODUCT["binary"], "Vendor": PRODUCT["vendor"], "Version": PRODUCT["version"]})
    app["AppUpdate"]["URL"] = ""
    with (runtime / "browser/application.ini").open("w") as file:
        app.write(file, space_around_delimiters=False)
    distribution = runtime / "distribution"
    distribution.mkdir(exist_ok=True)
    (distribution / "policies.json").write_text(json.dumps({"policies": {"DisableAppUpdate": True, "DontCheckDefaultBrowser": True, "OverrideFirstRunPage": "", "OverridePostUpdatePage": ""}}, indent=2))
    prefs = runtime / "defaults/pref/link-signal.js"
    prefs.parent.mkdir(parents=True, exist_ok=True)
    prefs.write_text('pref("zen.welcome-screen.seen", true);\npref("zen.watermark.enabled", false);\npref("app.update.url", "");\npref("browser.aboutwelcome.enabled", false);\n')
    launcher = bundle / PRODUCT["binary"]
    launcher.write_text('''#!/bin/sh
set -eu
browser_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$browser_dir/zen/zen" -app "$browser_dir/zen/browser/application.ini" --class=link-signal "$@"
''')
    launcher.chmod(0o755)
    shutil.copy(ROOT / "browser/icon.svg", bundle / "icon.svg")
    shutil.copy(ROOT / "LICENSE", bundle / "LICENSE")
    (bundle / "SOURCE.txt").write_text(f"Link Signal {PRODUCT['version']}\nBased on Zen {PRODUCT['upstreamVersion']}\nUpstream source: {PRODUCT['upstreamSource']}\nModifications: https://github.com/DeeGeeh/zen-slop/tree/feat/link-slop-meter\nRuntime SHA-256: {PRODUCT['runtimeSha256']}\n\nThis alpha uses manual browser updates. Do not use it as your daily browser.\n")
    desktop = f'''[Desktop Entry]
Type=Application
Name={PRODUCT["name"]}
Comment=Browse with AI-authorship signals
Exec=/opt/{PRODUCT["binary"]}/{PRODUCT["binary"]} %u
Icon=/opt/{PRODUCT["binary"]}/icon.svg
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass={PRODUCT["binary"]}
'''
    (bundle / "link-signal.desktop").write_text(desktop)
    archive_path = output / f"{PRODUCT['binary']}-{PRODUCT['version']}-linux-x86_64.tar.xz"
    with tarfile.open(archive_path, "w:xz", preset=3) as archive:
        archive.add(bundle, arcname=PRODUCT["binary"])

    package = output / "deb-root"
    (package / "DEBIAN").mkdir(parents=True)
    install_dir = package / "opt" / PRODUCT["binary"]
    shutil.copytree(bundle, install_dir, copy_function=os.link)
    applications = package / "usr/share/applications"
    applications.mkdir(parents=True)
    (applications / "link-signal.desktop").write_text(desktop)
    installed_kib = sum(file.stat().st_size for file in bundle.rglob("*") if file.is_file()) // 1024
    (package / "DEBIAN/control").write_text(f'''Package: link-signal-browser
Version: {PRODUCT["version"]}
Architecture: amd64
Maintainer: Link Signal
Section: web
Priority: optional
Installed-Size: {installed_kib}
Depends: libgtk-3-0, libdbus-glib-1-2, libasound2 | libasound2t64, libxt6, libx11-xcb1
Description: Link Signal browser alpha, based on Zen
 Includes estimated AI-authorship signals beside search results.
''')
    deb = output / f"link-signal-browser_{PRODUCT['version']}_amd64.deb"
    subprocess.run(["dpkg-deb", "--root-owner-group", "-Zxz", "-z3", "--build", str(package), str(deb)], check=True)
    (output / "SHA256SUMS").write_text("".join(f"{hashlib.file_digest(file.open('rb'), 'sha256').hexdigest()}  {file.name}\n" for file in [archive_path, deb]))
    print(f"Portable browser: {archive_path}\nDebian installer: {deb}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-archive", required=True, type=Path)
    parser.add_argument("--extension", type=Path, default=ROOT / "features/link-signal/dist/extension")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    build(args.runtime_archive.resolve(), args.extension.resolve(), args.output.resolve())
