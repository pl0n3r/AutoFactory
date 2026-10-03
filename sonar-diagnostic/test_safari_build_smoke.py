"""Regresiones del smoke Safari unsigned ligado a atestación."""
from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
from pathlib import Path

from tests.test_release_artifact_attestation import (
    ASSETS,
    SAFARI,
    SHA,
    TAG,
    VERSION,
    ReleaseArtifactAttestationTests,
)

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "safari-unsigned-build-smoke.sh"


class SafariBuildSmokeTests(ReleaseArtifactAttestationTests):
    test_attestation_binds_tag_sha_versions_assets_and_digests = None
    test_mismatch_symlink_or_undeclared_asset_fails_closed = None

    def setUp(self):
        super().setUp()
        self.bin_dir = Path(self.temp.name) / "bin"
        self.bin_dir.mkdir(parents=True)
        self.log = Path(self.temp.name) / "xcode.log"
        (
            self.fixture
            / "safari"
            / "ChatGPT Autopilot Local.xcodeproj"
        ).mkdir(parents=True, exist_ok=True)
        self.fake_xcode = self._write_executable(
            "xcodebuild",
            self._fake_xcode_source(),
        )

    def _write_executable(self, name: str, source: str) -> Path:
        target = self.bin_dir / name
        target.write_text(source, encoding="utf-8")
        target.chmod(target.stat().st_mode | stat.S_IXUSR)
        return target

    @staticmethod
    def _fake_xcode_source() -> str:
        return r'''#!/usr/bin/env python3
import os
import plistlib
import shutil
import sys
from pathlib import Path

args = sys.argv[1:]
Path(os.environ["AUTOFAC_XCODE_LOG"]).write_text(
    "\n".join(args),
    encoding="utf-8",
)
if os.environ.get("AUTOFAC_FAKE_BUILD_FAIL") == "1":
    raise SystemExit(9)

project = Path(args[args.index("-project") + 1])
source_root = project.parent.parent
settings = {
    item.split("=", 1)[0]: item.split("=", 1)[1]
    for item in args
    if "=" in item
}
build_root = Path(settings["SYMROOT"])
version = settings["MARKETING_VERSION"]
appex = (
    build_root
    / "Release"
    / "ChatGPT Autopilot Local.app"
    / "Contents"
    / "PlugIns"
    / "ChatGPT Autopilot Local Extension.appex"
)
resources = appex / "Contents" / "Resources"
resources.mkdir(parents=True, exist_ok=True)

safari_sources = (
    source_root
    / "safari"
    / "ChatGPT Autopilot Local Extension"
    / "Resources"
)
for source in safari_sources.rglob("*"):
    if not source.is_file():
        continue
    target = resources / source.relative_to(safari_sources)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)

info = {
    "CFBundleShortVersionString": version,
    "CFBundleVersion": "1",
}
with (appex / "Contents" / "Info.plist").open("wb") as handle:
    plistlib.dump(info, handle)
'''

    def _run(self, *, fail_build: bool = False):
        env = os.environ.copy()
        env.update({
            "AUTOFAC_SOURCE_ROOT": str(self.fixture),
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
        for expected in (
            "CODE_SIGNING_ALLOWED=NO",
            "CODE_SIGNING_REQUIRED=NO",
            "CODE_SIGN_IDENTITY=",
            "DEVELOPMENT_TEAM=",
            f"MARKETING_VERSION={VERSION}",
        ):
            self.assertIn(expected, log)

        smoke = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("release-artifact-attestation.cjs", smoke)
        self.assertIn("buildReleaseAttestation", smoke)

    def test_source_drift_or_build_failure_never_emits_green_evidence(self):
        (self.fixture / SAFARI / "content.js").write_text(
            "drift\n",
            encoding="utf-8",
        )
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
    import unittest

    unittest.main()
