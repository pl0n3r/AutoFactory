"""Ensure the official Chrome release ZIP contains all SHA-attested runtime files."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


class ReleasePackagedAssetsTests(unittest.TestCase):
    def test_release_zip_contains_every_attested_runtime_asset(self):
        version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
        with tempfile.TemporaryDirectory(prefix="autofactory-release-qa-") as tmp:
            env = {**os.environ, "AUTOFAC_DIST_DIR": tmp}
            packaged = subprocess.run(
                ["python3", "scripts/package-release.py"],
                cwd=ROOT, env=env, capture_output=True, text=True, check=False,
            )
            self.assertEqual(packaged.returncode, 0, packaged.stderr)
            sha = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=ROOT,
                capture_output=True, text=True, check=True,
            ).stdout.strip()
            attested = subprocess.run(
                ["node", "scripts/release-artifact-attestation.cjs", f"v{version}", sha],
                cwd=ROOT, capture_output=True, text=True, check=True,
            )
            record = json.loads(attested.stdout)
            assets = {row["path"]: row for row in record["assets"]}
            zip_file = Path(tmp) / f"chatgpt-autopilot-local-chrome-v{version}.zip"
            self.assertTrue(zip_file.is_file())
            with ZipFile(zip_file) as archive:
                self.assertEqual(set(archive.namelist()), set(assets))
                self.assertIn("background-entry.js", assets)
                self.assertIn("adaptive-recovery.js", assets)
                self.assertIn("shared-learning-sync.js", assets)
                self.assertIn("recovery-incident.js", assets)
                for relative, row in assets.items():
                    blob = archive.read(relative)
                    self.assertEqual(len(blob), row["size"], relative)
                    self.assertEqual(
                        hashlib.sha256(blob).hexdigest(), row["chrome_sha256"], relative
                    )
            safari_zip = Path(tmp) / f"chatgpt-autopilot-local-safari-source-v{version}.zip"
            self.assertTrue(safari_zip.is_file())
            with ZipFile(safari_zip) as archive:
                names = set(archive.namelist())
                self.assertIn("build-safari.sh", names)
                self.assertIn("safari/ChatGPT Autopilot Local Extension/Resources/manifest.json", names)


if __name__ == "__main__":
    unittest.main()
