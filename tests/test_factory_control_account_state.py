"""Criterios ejecutables del observador de estado de cuenta, sin proveedor externo."""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS_FILE = ROOT / "factory-control-account-state.js"
TEST_FILE = ROOT / "test-factory-control-account-state.cjs"


def run_fake_contract():
    result = subprocess.run(
        ["node", str(TEST_FILE)], cwd=ROOT, capture_output=True,
        text=True, timeout=30, check=False,
    )
    if result.returncode != 0:
        raise AssertionError("El contrato Node de estados de cuenta falló")
    return result.stdout


class FactoryControlAccountStateTests(unittest.TestCase):
    def test_usage_limit_with_timestamp_and_freshness(self):
        self.assertIn("account-state AC-01: ok", run_fake_contract())
        code = JS_FILE.read_text(encoding="utf-8")
        self.assertIn("createProviderAccountStateObserver", code)
        self.assertIn("observedAt, freshness: 'fresh'", code)

    def test_signed_out_signal_excludes_sensitive_content(self):
        self.assertIn("account-state AC-02: ok", run_fake_contract())
        code = JS_FILE.read_text(encoding="utf-8")
        self.assertIn("exactObject(raw, fields)", code)
        self.assertIn("return unknownObservation()", code)

    def test_recovery_to_ready_and_stale_fail_closed(self):
        self.assertIn("account-state AC-03: ok", run_fake_contract())
        code = JS_FILE.read_text(encoding="utf-8")
        self.assertIn("nowMs - observedAt > maxAgeMs", code)
        self.assertIn("unknownObservation('stale')", code)


if __name__ == "__main__":
    unittest.main()
