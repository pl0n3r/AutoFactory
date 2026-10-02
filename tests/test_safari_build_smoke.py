"""Regresiones del smoke Safari unsigned ligado a atestación."""
from __future__ import annotations

import json
import os
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "safari-unsigned-build-smoke.sh"
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


class SafariBuildSmokeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.fixture = Path(self.temp.name) / "source"
        self.bin_dir = Path(self.temp.name) / "bin"
        self.bin_dir.mkdir(parents=True)
        self.log = Path(self.temp.name) / "xcode.log"
        self._write_fixture()
        self.fake_node = self._write_executable("node", self._fake_node_source())
        self.fake_xcode = self._write_executable("xcodebuild", self._fake_xcode_source())

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
                "default_icon": {"16": "icons/icon-16.png", "32": "icons/icon-32.png"},
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
        self.fixture.mkdir(parents=True, exist_ok=True)
        (self.fixture / "safari" / "ChatGPT Autopilot Local.xcodeproj").mkdir(parents=True, exist_ok=True)
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

    def _write_executable(self, name: str, source: str) -> Path:
        target = self.bin_dir / name
        target.write_text(source, encoding="utf-8")
        target.chmod(target.stat().st_mode | stat.S_IXUSR)
        return target

    @staticmethod
    def _fake_node_source() -> str:
        return r'''#!/usr/bin/env python3
import hashlib
import json
import sys
from pathlib import Path

_, _dash_e, _expr, _module, source_root, tag, sha = sys.argv
root = Path(source_root)
version = json.loads((root / "manifest.json").read_text())["version"]
if tag != "v" + version or len(sha) != 40:
    raise SystemExit(2)
assets = [
    "account-budget-background.js", "account-budget-guard.js", "account-budget.js",
    "autopilot-core.js", "background-entry.js", "background.js", "content.js",
    "icons/icon-128.png", "icons/icon-16.png", "icons/icon-32.png", "learning.js",
    "manifest.json", "popup-budget.js", "popup.html", "popup.js", "reliability.js",
]
rows = []
for relative in assets:
    chrome = root / relative
    safari = root / "safari" / "ChatGPT Autopilot Local Extension" / "Resources" / relative
    if not chrome.is_file() or not safari.is_file():
        raise SystemExit("missing attested source")
    left = chrome.read_bytes()
    right = safari.read_bytes()
    if left != right:
        raise SystemExit("attested source drift")
    rows.append({
        "path": relative,
        "size": len(right),
        "safari_sha256": hashlib.sha256(right).hexdigest(),
    })
evidence = {
    "schema_version": 1,
    "tag": tag,
    "commit_sha": sha,
    "release_version": version,
    "assets": rows,
}
evidence["attestation_sha256"] = hashlib.sha256(
    json.dumps(evidence, separators=(",", ":")).encode()
).hexdigest()
print(json.dumps(evidence, separators=(",", ":")))
'''

    @staticmethod
    def _fake_xcode_source() -> str:
        return r'''#!/usr/bin/env python3
import os
import plistlib
import shutil
import sys
from pathlib import Path

args = sys.argv[1:]
log = Path(os.environ["AUTOFAC_XCODE_LOG"])
log.write_text("\n".join(args), encoding="utf-8")
if os.environ.get("AUTOFAC_FAKE_BUILD_FAIL") == "1":
    raise SystemExit(9)
project = Path(args[args.index("-project") + 1])
root = project.parent.parent
values = {item.split("=", 1)[0]: item.split("=", 1)[1] for item in args if "=" in item}
build_root = Path(values["SYMROOT"])
version = values["MARKETING_VERSION"]
appex = build_root / "Release" / "ChatGPT Autopilot Local.app" / "Contents" / "PlugIns" / "ChatGPT Autopilot Local Extension.appex"
resources = appex / "Contents" / "Resources"
resources.mkdir(parents=True, exist_ok=True)
source = root / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"
for item in source.rglob("*"):
    if item.is_file():
        target = resources / item.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(item, target)
info = {"CFBundleShortVersionString": version, "CFBundleVersion": "1"}
with (appex / "Contents" / "Info.plist").open("wb") as handle:
    plistlib.dump(info, handle)
'''

    def _run(self, *, fail_build: bool = False):
        env = os.environ.copy()
        env.update({
            "AUTOFAC_SOURCE_ROOT": str(self.fixture),
            "AUTOFAC_NODE_BIN": str(self.fake_node),
            "AUTOFAC_XCODEBUILD_BIN": str(self.fake_xcode),
            "AUTOFAC_PYTHON_BIN": sys.executable,
            "AUTOFAC_XCODE_LOG": str(self.log),
        })
        if fail_build:
            env["AUTOFAC_FAKE_BUILD_FAIL"] = "1"
        return subprocess.run(
            ["bash", str(SCRIPT), TAG, SHA],
            cwd=ROOT,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_unsigned_build_uses_attested_sources_and_expected_bundle_version(self):
        result = self._run()
        self.assertEqual(result.returncode, 0, result.stderr)
        evidence = json.loads(result.stdout)
        self.assertEqual(evidence["status"], "green")
        self.assertEqual(evidence["release_version"], VERSION)
        self.assertEqual(evidence["code_signing"], "disabled")
        self.assertEqual(evidence["assets_verified"], len(ASSETS))
        log = self.log.read_text(encoding="utf-8")
        self.assertIn("CODE_SIGNING_ALLOWED=NO", log)
        self.assertIn("CODE_SIGNING_REQUIRED=NO", log)
        self.assertIn("CODE_SIGN_IDENTITY=", log)
        self.assertIn("DEVELOPMENT_TEAM=", log)
        self.assertIn(f"MARKETING_VERSION={VERSION}", log)
        smoke = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("release-artifact-attestation.cjs", smoke)
        self.assertIn("buildReleaseAttestation", smoke)

    def test_source_drift_or_build_failure_never_emits_green_evidence(self):
        drifted = self.fixture / SAFARI / "content.js"
        drifted.write_text("drift\n", encoding="utf-8")
        drift = self._run()
        self.assertNotEqual(drift.returncode, 0)
        self.assertNotIn('"status":"green"', drift.stdout)

        self._write_fixture()
        if self.log.exists():
            self.log.unlink()
        failed = self._run(fail_build=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertNotIn('"status":"green"', failed.stdout)
        self.assertIn("xcodebuild failed", failed.stderr)


if __name__ == "__main__":
    unittest.main()
