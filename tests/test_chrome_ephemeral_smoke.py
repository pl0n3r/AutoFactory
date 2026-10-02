"""Regresiones del smoke Chrome efímero y secret-free."""
from __future__ import annotations

import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "chrome-ephemeral-smoke.cjs"
VERSION = "1.2.3"
TAG = f"v{VERSION}"
SHA = "b" * 40
SAFARI = Path("safari") / "ChatGPT Autopilot Local Extension" / "Resources"
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


class ChromeEphemeralSmokeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.fixture = Path(self.temp.name)
        self._write_fixture()
        self.chrome = self.fixture / "fake-chrome"
        self.capture = self.fixture / "chrome-capture.json"
        self._write_fake_chrome("success")

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

    def _write(self, relative, data):
        target = self.fixture / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, str):
            data = data.encode("utf-8")
        target.write_bytes(data)

    def _mirror(self, relative, data):
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

    def _write_fake_chrome(self, mode):
        body = f"""#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const value = prefix => (args.find(item => item.startsWith(prefix)) || '').slice(prefix.length);
const profile = value('--user-data-dir=');
const extension = value('--load-extension=');
fs.writeFileSync(
  path.join(__dirname, 'chrome-capture.json'),
  JSON.stringify({{args, profile, extension, home: process.env.HOME}})
);
if (!profile || !extension || !fs.existsSync(path.join(extension, 'manifest.json'))) process.exit(31);
if ({json.dumps(mode)} === 'exit') process.exit(23);
if ({json.dumps(mode)} === 'runtime') {{
  console.error('Failed to load extension: synthetic runtime failure');
  process.exit(0);
}}
console.log('<html><body>ok</body></html>');
"""
        self.chrome.write_text(body, encoding="utf-8")
        self.chrome.chmod(
            self.chrome.stat().st_mode
            | stat.S_IXUSR
            | stat.S_IXGRP
            | stat.S_IXOTH
        )

    def _run(self):
        expression = (
            "const m=require(process.argv[1]);"
            "try{console.log(JSON.stringify(m.runChromeSmoke({"
            "root:process.argv[2],chromeBinary:process.argv[3],"
            "tag:process.argv[4],commitSha:process.argv[5],"
            "tempRoot:process.argv[6]}))}"
            "catch(e){console.error(e.message);process.exit(1)}"
        )
        return subprocess.run(
            [
                "node", "-e", expression, str(SCRIPT), str(self.fixture),
                str(self.chrome), TAG, SHA, str(self.fixture),
            ],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_ephemeral_profile_loads_packaged_extension_without_user_data(self):
        result = self._run()
        self.assertEqual(result.returncode, 0, result.stderr)
        evidence = json.loads(result.stdout)
        capture = json.loads(self.capture.read_text(encoding="utf-8"))

        self.assertTrue(evidence["verified"])
        self.assertEqual(evidence["profile_mode"], "ephemeral")
        self.assertEqual(evidence["extension_mode"], "attested-copy")
        self.assertEqual(evidence["commit_sha"], SHA)
        self.assertEqual(evidence["tag"], TAG)
        self.assertEqual(evidence["assets"], len(ASSETS))
        self.assertTrue(evidence["cleanup"])

        self.assertEqual(capture["home"], capture["profile"])
        self.assertNotEqual(capture["profile"], str(Path.home()))
        self.assertIn("--headless=new", capture["args"])
        self.assertIn("--disable-background-networking", capture["args"])
        self.assertFalse(Path(capture["profile"]).exists())
        self.assertFalse(Path(capture["extension"]).exists())

    def test_runtime_error_or_permission_drift_fails_closed(self):
        self._write_fake_chrome("runtime")
        runtime = self._run()
        self.assertNotEqual(runtime.returncode, 0)
        self.assertIn("runtime/load error", runtime.stderr)

        self._write_fixture()
        manifest = self._manifest()
        manifest["permissions"].append("webRequest")
        encoded = json.dumps(manifest, separators=(",", ":"))
        self._write("manifest.json", encoded)
        self._write(SAFARI / "manifest.json", encoded)
        self._write_fake_chrome("success")
        permission = self._run()
        self.assertNotEqual(permission.returncode, 0)
        self.assertIn("unexpected permission", permission.stderr)


if __name__ == "__main__":
    unittest.main()
