"""#285: execute the real isolated Node freshness contract; no browser/network."""
from __future__ import annotations

from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "test-factory-control-account-state-freshness.cjs"
MODULE = ROOT / "factory-control-account-state-freshness.js"


class AccountStateFreshnessTests(unittest.TestCase):
    def _run(self, criterion: str) -> None:
        self.assertTrue(TEST.is_file())
        self.assertTrue(MODULE.is_file())
        result = subprocess.run(
            ["node", str(TEST), criterion], cwd=ROOT, text=True,
            capture_output=True, check=False, timeout=30,
        )
        self.assertEqual(
            0, result.returncode,
            f"{criterion} failed: {result.stdout[-450:]} {result.stderr[-650:]}",
        )
        self.assertEqual(f"{criterion}: ok", result.stdout.strip())

    def test_stale_limit_login_fails_closed(self) -> None:
        self._run("AC-01")

    def test_unknown_never_enables_capacity(self) -> None:
        self._run("AC-02")
        source = MODULE.read_text(encoding="utf-8")
        for forbidden in (
            "fetch(", "XMLHttpRequest", "document.querySelector",
            "chrome.tabs", "chrome.storage", "browser.tabs", "localStorage",
            "WebSocket", "sendMessage(",
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
