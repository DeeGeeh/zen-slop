import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("packager", Path(__file__).with_name("package.py"))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackageTest(unittest.TestCase):
    def test_bundles_feature_and_rebrands_without_removing_upstream_addons(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, destination = root / "source.zip", root / "result.zip"
            extension = root / "extension"
            extension.mkdir()
            manifest = {"version": "0.1.0", "browser_specific_settings": {"gecko": {"id": "test@signal"}}}
            (extension / "manifest.json").write_text(json.dumps(manifest))
            (extension / "content.js").write_text("/* bundled */")
            with ZipFile(source, "w") as archive:
                archive.writestr(packager.BUILTINS, json.dumps({"builtins": [{"addon_id": "webcompat@mozilla.org"}]}))
                archive.writestr("localization/en-US/branding/brand.ftl", "-brand-short-name = Zen")
                archive.writestr("untouched.txt", "keep me")
            packager.patch_omni(source, destination, extension)
            with ZipFile(destination) as archive:
                builtins = json.loads(archive.read(packager.BUILTINS))["builtins"]
                self.assertEqual([addon["addon_id"] for addon in builtins], ["webcompat@mozilla.org", "test@signal"])
                self.assertEqual(builtins[-1]["res_url"], "resource://builtin-addons/link-signal/")
                self.assertEqual(json.loads(archive.read(packager.ADDON_ROOT + "manifest.json")), manifest)
                self.assertEqual(archive.read("untouched.txt"), b"keep me")
                self.assertIn(b"Link Signal", archive.read("localization/en-US/branding/brand.ftl"))

    def test_rejects_unknown_runtime_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "manifest.json").write_text("{}")
            with ZipFile(root / "source.zip", "w") as archive:
                archive.writestr("file.txt", "unrelated archive")
            with self.assertRaisesRegex(ValueError, "built-in registration missing"):
                packager.patch_omni(root / "source.zip", root / "output.zip", root)


if __name__ == "__main__":
    unittest.main()
