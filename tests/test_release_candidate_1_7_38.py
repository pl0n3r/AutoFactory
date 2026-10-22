"""Aceptación del candidato 1.7.38, sin activar servicios ni datos reales."""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_VERSION = "1.7.38"


class ReleaseCandidate1738Tests(unittest.TestCase):
    def test_versions_are_aligned_and_documented(self):
        manifests = (
            ROOT / "manifest.json",
            ROOT / "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json",
            ROOT / "package.json",
        )
        for path in manifests:
            with self.subTest(path=str(path.relative_to(ROOT))):
                content = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(EXPECTED_VERSION, content["version"])

        lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(EXPECTED_VERSION, lock["version"])
        self.assertEqual(EXPECTED_VERSION, lock["packages"][""]["version"])

        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        heading = "## 1.7.38 — 2026-10-21"
        self.assertEqual(1, changelog.count(heading))
        entry = changelog.split(heading, 1)[1].split("\n## ", 1)[0]
        self.assertIn("Volver a intentar", entry)
        self.assertIn("Try again", entry)
        self.assertIn("10 minutos", entry)
        self.assertIn("pestañas dirigidas", entry)
        self.assertIn("sin generación", entry)
        self.assertIn("campo de escritura", entry)


if __name__ == "__main__":
    unittest.main()
