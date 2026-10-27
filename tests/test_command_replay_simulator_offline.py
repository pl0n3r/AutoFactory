"""#284: actual Node ledger and offline replay harness, no browser or sender."""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "test-factory-control-command-replay-simulator.cjs"
MODULE = ROOT / "factory-control-command-replay-simulator.js"


def run_fixture() -> str:
    result = subprocess.run(
        ["node", SCRIPT.name], cwd=ROOT, capture_output=True,
        text=True, check=False, timeout=25,
    )
    if result.returncode:
        raise AssertionError("Offline replay harness failed: no real operations attempted")
    return result.stdout


class CommandReplaySimulatorTests(unittest.TestCase):
    def test_lost_ack_retry_no_duplicate_effect(self):
        self.assertIn(
            "AC-01: lost ACK, replay, late outcome, persistent restart: PASS",
            run_fixture(),
        )

    def test_opaque_failure_and_revoked_identity(self):
        self.assertIn(
            "AC-02: revoked, stale, unknown, opaque failures and no real effects: PASS",
            run_fixture(),
        )
        js = MODULE.read_text(encoding="utf-8")
        for prohibited in ("fetch(", "XMLHttpRequest", "chrome.tabs", "browser.tabs",
                           "WebSocket", "localStorage", "document.querySelector"):
            self.assertNotIn(prohibited, js)
        self.assertIn("const ledger = createLedger(", js)
        self.assertIn("ledger.deferOutcome()", js)


if __name__ == "__main__":
    unittest.main()
