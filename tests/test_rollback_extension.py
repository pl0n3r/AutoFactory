"""Aceptación offline de rollback: dos versiones ficticias, cero navegadores reales."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/verify_extension_version.py"
SAFARI = "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json"


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def synthetic_version(root: Path, version: str, source: str, safari_version: str | None = None) -> str:
    root.mkdir()
    git(root, "init", "-q")
    for name, payload in (
        ("manifest.json", {"manifest_version": 3, "version": version}),
        (SAFARI, {"manifest_version": 3, "version": safari_version or version}),
        ("package.json", {"name": "offline-fixture", "version": version}),
        ("package-lock.json", {"version": version, "packages": {"": {"version": version}}}),
    ):
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload), encoding="utf-8")
    (root / "content.js").write_text(source, encoding="utf-8")
    git(root, "add", ".")
    git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "offline fixture")
    return git(root, "rev-parse", "HEAD")


def check(root: Path, sha: str, version: str):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(root), "--sha", sha, "--version", version],
        capture_output=True, text=True, check=False,
    )


class RollbackExtensionTests(unittest.TestCase):
    def test_two_fake_versions_and_tampering(self):
        with tempfile.TemporaryDirectory(prefix="af427-rollback-") as tmp:
            previous, current = Path(tmp) / "previous", Path(tmp) / "current"
            sha_old = synthetic_version(previous, "1.7.37", "// previous offline fixture\n")
            sha_new = synthetic_version(current, "1.7.38", "// current offline fixture\n")
            for folder, sha, version in (
                (previous, sha_old, "1.7.37"), (current, sha_new, "1.7.38")
            ):
                with self.subTest(version=version, state="intact"):
                    ok = check(folder, sha, version)
                    self.assertEqual(0, ok.returncode, ok.stderr)
                    self.assertIn("VERIFICADO:", ok.stdout)
                    self.assertIn(f"carpeta={folder}", ok.stdout)
                with self.subTest(version=version, state="wrong SHA"):
                    self.assertNotEqual(0, check(folder, "0" * 40, version).returncode)
                with self.subTest(version=version, state="wrong version"):
                    self.assertNotEqual(0, check(folder, sha, "9.9.9").returncode)
                path = folder / "content.js"
                original = path.read_bytes()
                path.write_bytes(original + b"// tampered\n")
                with self.subTest(version=version, state="tampered executable"):
                    self.assertNotEqual(0, check(folder, sha, version).returncode)
                path.write_bytes(original)
                extra = folder / "extra.js"
                extra.write_text("// untracked code", encoding="utf-8")
                with self.subTest(version=version, state="untracked executable"):
                    self.assertNotEqual(0, check(folder, sha, version).returncode)
                extra.unlink()
                with self.subTest(version=version, state="restored"):
                    self.assertEqual(0, check(folder, sha, version).returncode)
            target = previous / SAFARI
            backup = target.read_bytes()
            target.write_text('{"version":"1.7.38"}', encoding="utf-8")
            self.assertNotEqual(0, check(previous, sha_old, "1.7.37").returncode)
            target.write_bytes(backup)
            self.assertEqual(0, check(previous, sha_old, "1.7.37").returncode)
            # Committed Safari drift must be detected independently from modified blobs.
            mismatched = Path(tmp) / "mismatched"
            mismatch_sha = synthetic_version(
                mismatched, "1.7.37", "// mismatched fixture\n", safari_version="1.7.38"
            )
            self.assertNotEqual(0, check(mismatched, mismatch_sha, "1.7.37").returncode)

            # Git replace objects must not conceal modified content.
            replaced = Path(tmp) / "replaced"
            replace_sha = synthetic_version(replaced, "1.7.37", "// pristine fixture\n")
            original_oid = git(replaced, "rev-parse", "HEAD:content.js")
            (replaced / "content.js").write_text("// malicious replacement\n", encoding="utf-8")
            replacement_oid = git(replaced, "hash-object", "-w", "content.js")
            git(replaced, "replace", original_oid, replacement_oid)
            self.assertNotEqual(0, check(replaced, replace_sha, "1.7.37").returncode)

            # Without Git metadata, a folder's claimed version cannot certify its SHA.
            without_git = Path(tmp) / "no-git"
            without_git.mkdir()
            (without_git / "manifest.json").write_text('{"version":"1.7.37"}')
            self.assertNotEqual(0, check(without_git, sha_old, "1.7.37").returncode)


if __name__ == "__main__":
    unittest.main()
