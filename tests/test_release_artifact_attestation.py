"""Regresiones de atestación determinista de artefactos AutoFactory."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "release-artifact-attestation.cjs"
VERSION = "1.2.3"
TAG = f"v{VERSION}"
SHA = "a" * 40

ASSETS = (
    "account-budget-background.js",
    "account-budget-guard.js",
    "account-budget.js",
    "autopilot-core.js",
    "background-entry.js",
    "background.js",
    "content.js",
    "icons/icon-128.png",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "learning.js",
    "manifest.json",
    "popup-budget.js",
    "popup.html",
    "popup.js",
    "reliability.js",
)
SAFARI = Path("safari") / "ChatGPT Autopilot Local Extension" / "Resources"


class ReleaseArtifactAttestationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.fixture = Path(self.temp.name)
        self._write_fixture()

    def tearDown(self):
        self.temp.cleanup()

    def _manifest(self):
        return {
            "manifest_version": 3,
            "name": "Fixture",
            "version": VERSION,
            "permissions": ["activeTab", "storage", "tabs", "alarms"],
            "host_permissions": ["https://chatgpt.com/*"],
            "action": {
                "default_popup": "popup.html",
                "default_icon": {
                    "16": "icons/icon-16.png",
                    "32": "icons/icon-32.png",
                },
            },
            "background": {"service_worker": "background-entry.js"},
            "content_scripts": [{
                "matches": ["https://chatgpt.com/*"],
                "js": [
                    "autopilot-core.js",
                    "account-budget-guard.js",
                    "learning.js",
                    "reliability.js",
                    "content.js",
                ],
            }],
            "icons": {
                "16": "icons/icon-16.png",
                "32": "icons/icon-32.png",
                "128": "icons/icon-128.png",
            },
        }

    def _write(self, relative: str | Path, data: bytes | str):
        target = self.fixture / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, str):
            data = data.encode("utf-8")
        target.write_bytes(data)

    def _mirror(self, relative: str | Path, data: bytes | str):
        self._write(relative, data)
        self._write(SAFARI / relative, data)

    def _write_fixture(self):
        manifest = json.dumps(self._manifest(), separators=(",", ":"))
        package = json.dumps({"name": "fixture", "version": VERSION})
        lock = json.dumps({
            "name": "fixture",
            "version": VERSION,
            "packages": {"": {"name": "fixture", "version": VERSION}},
        })
        self._mirror("manifest.json", manifest)
        self._write("package.json", package)
        self._write("package-lock.json", lock)

        self._mirror(
            "popup.html",
            '<html><script src="popup.js"></script>'
            '<script src="popup-budget.js"></script></html>',
        )
        self._mirror(
            "background-entry.js",
            "importScripts('account-budget.js','background.js',"
            "'account-budget-background.js');",
        )

        for relative in ASSETS:
            if relative in {"manifest.json", "popup.html", "background-entry.js"}:
                continue
            self._mirror(relative, f"fixture:{relative}\n")

    def _run(self, *, tag=TAG, sha=SHA):
        expression = (
            "const m=require(process.argv[1]);"
            "try{console.log(JSON.stringify("
            "m.buildReleaseAttestation(process.argv[2],process.argv[3],process.argv[4])))"
            "}catch(e){console.error(e.message);process.exit(1)}"
        )
        return subprocess.run(
            [
                "node",
                "-e",
                expression,
                str(SCRIPT),
                str(self.fixture),
                tag,
                sha,
            ],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_attestation_binds_tag_sha_versions_assets_and_digests(self):
        first = self._run()
        self.assertEqual(first.returncode, 0, first.stderr)
        result = json.loads(first.stdout)

        self.assertEqual(result["schema_version"], 1)
        self.assertEqual(result["tag"], TAG)
        self.assertEqual(result["commit_sha"], SHA)
        self.assertEqual(result["release_version"], VERSION)
        self.assertEqual(result["digest_algorithm"], "sha256")
        self.assertEqual(
            [row["path"] for row in result["assets"]],
            sorted(ASSETS),
        )
        self.assertRegex(result["attestation_sha256"], r"^[0-9a-f]{64}$")
        for row in result["assets"]:
            self.assertGreater(row["size"], 0)
            self.assertRegex(row["chrome_sha256"], r"^[0-9a-f]{64}$")
            self.assertEqual(row["chrome_sha256"], row["safari_sha256"])

        repeated = self._run()
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assertEqual(json.loads(repeated.stdout), result)

        bad_sha = self._run(sha="short")
        self.assertNotEqual(bad_sha.returncode, 0)
        bad_tag = self._run(tag="v9.9.9")
        self.assertNotEqual(bad_tag.returncode, 0)

    def test_mismatch_symlink_or_undeclared_asset_fails_closed(self):
        safari_content = self.fixture / SAFARI / "content.js"
        safari_content.write_text("drift\n", encoding="utf-8")
        mismatch = self._run()
        self.assertNotEqual(mismatch.returncode, 0)
        self.assertIn("Chrome/Safari asset mismatch", mismatch.stderr)

        self._write_fixture()
        popup = self.fixture / "popup.js"
        popup.unlink()
        popup.symlink_to(self.fixture / "content.js")
        symlink = self._run()
        self.assertNotEqual(symlink.returncode, 0)
        self.assertIn("regular file", symlink.stderr)

        popup.unlink()
        self._write_fixture()
        manifest = self._manifest()
        manifest["content_scripts"][0]["js"].append("unexpected.js")
        encoded = json.dumps(manifest, separators=(",", ":"))
        self._write("manifest.json", encoded)
        self._write(SAFARI / "manifest.json", encoded)
        self._mirror("unexpected.js", "fixture:unexpected\n")
        undeclared = self._run()
        self.assertNotEqual(undeclared.returncode, 0)
        self.assertIn("undeclared runtime asset", undeclared.stderr)


if __name__ == "__main__":
    unittest.main()
