"""Regresiones CodeQL del relay de SonarCloud, AutoFactory #272."""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELAY = ROOT / "scripts" / "sonar-check-relay.cjs"
REGRESSION = ROOT / "test-sonar-check-relay.cjs"


class SonarRelaySanitizationTests(unittest.TestCase):
    def test_atomic_sanitization(self):
        source = RELAY.read_text(encoding="utf-8")
        plain = source.split("function plain(", 1)[1].split("function code(", 1)[0]
        self.assertIn("for (const ch of", plain)
        self.assertIn("Object.prototype.hasOwnProperty.call(escaped, ch)", plain)
        self.assertNotIn(".replace(", plain)

    def test_adversarial_escaping(self):
        p = subprocess.run(
            ["node", "test-sonar-check-relay.cjs"],
            cwd=ROOT, text=True, capture_output=True, check=False, timeout=45,
        )
        self.assertEqual(p.returncode, 0, p.stderr[:1500])
        source = REGRESSION.read_text(encoding="utf-8")
        for term in ("'<svg>@all**[profile]'", "javascript:alert(1)",
                     "String.fromCharCode(92, 96)", "sonarFixture"):
            self.assertIn(term, source)

    def test_exact_head_contract(self):
        source = RELAY.read_text(encoding="utf-8")
        for term in ("check.app?.slug === SONAR_APP",
                     "pr.head?.sha === sha",
                     "check.head_sha === pr.head.sha",
                     "if (previous && previous.body === body) continue"):
            self.assertIn(term, source)


if __name__ == "__main__":
    unittest.main()
