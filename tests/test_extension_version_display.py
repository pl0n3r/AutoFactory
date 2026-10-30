"""#429 - Offline version/SHA identity and fail-closed synthetic release tags."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "verify_extension_version.py"
SAFARI = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"
spec = importlib.util.spec_from_file_location("autofactory_version_verifier", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("Version verifier unavailable")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def fixture(folder: Path, version: str, sha: str) -> None:
    folder.mkdir()
    (folder / "manifest.json").write_text(
        json.dumps({"manifest_version": 3, "version": version}), encoding="utf-8"
    )
    (folder / "extension-build.json").write_text(
        json.dumps({"version": version, "sha": sha, "tag": "v" + version}),
        encoding="utf-8",
    )


class VerifyExtensionVersionTests(unittest.TestCase):
    def test_criterio_principal(self):
        """AC-01: two invented releases, mismatch denial, mirrored popup identity."""
        with tempfile.TemporaryDirectory(prefix="autofactory-429-") as td:
            first = Path(td) / "first"
            second = Path(td) / "second"
            a, b = "a" * 40, "b" * 40
            for folder, version, sha in (
                (first, "1.7.37", a), (second, "1.7.38", b),
            ):
                fixture(folder, version, sha)
                self.assertEqual(
                    verifier.verify_published_build(folder, sha, version, "v" + version),
                    sha,
                )
                cli = subprocess.run(
                    [sys.executable, str(SCRIPT), str(folder),
                     "--sha", sha, "--version", version,
                     "--published-tag", "v" + version],
                    capture_output=True, text=True, check=False,
                )
                self.assertEqual(cli.returncode, 0, cli.stderr)
                self.assertIn("VERIFICADO:", cli.stdout)
                for expected_sha, expected_version, tag in (
                    ("0" * 40, version, "v" + version),
                    (sha, "9.9.9", "v9.9.9"),
                    (sha, version, "v9.9.9"),
                    (sha.upper(), version, "v" + version),
                ):
                    with self.subTest(folder=folder.name, tag=tag, sha=expected_sha):
                        with self.assertRaises(verifier.VerificationError):
                            verifier.verify_published_build(
                                folder, expected_sha, expected_version, tag
                            )
            record = second / "extension-build.json"
            original = record.read_text(encoding="utf-8")
            for payload in (
                '{"version":"1.7.38","sha":"faked","tag":"v1.7.38"}',
                '{"version":"1.7.38","sha":"%s","tag":"v1.7.37"}' % b,
                '{"version":"1.7.38","sha":"%s","tag":"v1.7.38","extra":true}' % b,
                '{"version":"1.7.38","sha":"%s"}' % b,
                "not JSON",
            ):
                with self.subTest(payload=payload[:60]):
                    record.write_text(payload, encoding="utf-8")
                    with self.assertRaises(verifier.VerificationError):
                        verifier.verify_published_build(second, b, "1.7.38", "v1.7.38")
            record.write_text(original, encoding="utf-8")
            (second / "manifest.json").write_text('{"version":"0.0.0"}')
            with self.assertRaises(verifier.VerificationError):
                verifier.verify_published_build(second, b, "1.7.38", "v1.7.38")
            record.unlink()
            record.symlink_to(first / "extension-build.json")
            with self.assertRaises(verifier.VerificationError):
                verifier.verify_published_build(second, b, "1.7.38", "v1.7.38")

        js = (ROOT / "popup.js").read_bytes()
        html = (ROOT / "popup.html").read_bytes()
        self.assertEqual(js, (SAFARI / "popup.js").read_bytes())
        self.assertEqual(html, (SAFARI / "popup.html").read_bytes())
        self.assertIn(b'id="build-identity"', html)
        self.assertIn(b"extension-build.json", js)
        self.assertIn(b"SHA NO VERIFICADO", js)
        self.assertIn(b"cotejo externo obligatorio", js)
        pkg = (ROOT / "scripts" / "package-release.py").read_text(encoding="utf-8")
        self.assertIn('archive.writestr("extension-build.json", build_identity)', pkg)
        self.assertIn(
            '"safari/ChatGPT Autopilot Local Extension/Resources/extension-build.json", build_identity',
            pkg,
        )


if __name__ == "__main__":
    unittest.main()
