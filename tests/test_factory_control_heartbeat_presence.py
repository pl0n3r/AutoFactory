"""AC-01..03: presencia de heartbeat con transporte fake y reloj determinista."""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS_FILE = ROOT / "factory-control-heartbeat.js"
TEST_FILE = ROOT / "test-factory-control-heartbeat.cjs"


def run_fake_contract() -> str:
    result = subprocess.run(
        ["node", str(TEST_FILE)], cwd=ROOT,
        capture_output=True, text=True, timeout=30, check=False,
    )
    if result.returncode != 0:
        raise AssertionError("El contrato Node heartbeat falló (ver CI)")
    return result.stdout


class HeartbeatPresenceTests(unittest.TestCase):
    def test_interval_and_confirmed_delivery(self):
        self.assertIn("heartbeat-presence AC-01: ok", run_fake_contract())
        code = JS_FILE.read_text(encoding="utf-8")
        self.assertIn("OFFLINE_AFTER_MISSES = 3", code)
        self.assertIn("receipt.confirmed !== true", code)
        self.assertIn("createHeartbeatCoordinator({", code)

    def test_missed_intervals_offline_and_recovery(self):
        self.assertIn("heartbeat-presence AC-02: ok", run_fake_contract())
        code = JS_FILE.read_text(encoding="utf-8")
        self.assertIn("Math.floor((current - anchor) / MIN_INTERVAL_MS)", code)
        self.assertIn("lastConfirmedAt = finished", code)

    def test_stopped_invalid_clock_and_private_payload(self):
        self.assertIn("heartbeat-presence AC-03: ok", run_fake_contract())
        code = JS_FILE.read_text(encoding="utf-8")
        self.assertIn("if (stopped)", code)
        self.assertIn("return Object.freeze({ state: 'unknown'", code)
        self.assertNotIn("private-token", code)


if __name__ == "__main__":
    unittest.main()
