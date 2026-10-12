"""AutoFactory #151: real Node assertions for V2 durable-receipt acceptance."""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class FactoryControlV2LedgerPersistenceTests(unittest.TestCase):
    def run_node(self, marker: str) -> None:
        result = subprocess.run(
            ["node", "test-factory-control-ledger.cjs"], cwd=ROOT,
            capture_output=True, text=True, timeout=45, check=False
        )
        self.assertEqual(result.returncode, 0, result.stdout + "\n" + result.stderr)
        self.assertIn(marker, result.stdout)

    def test_false_and_silent_save_deny_effect(self) -> None:
        self.run_node("AC-V2-01: false and silent saves deny effects")

    def test_done_failure_keeps_pending_and_replay_blocked(self) -> None:
        self.run_node("AC-V2-02: done failure keeps pending and blocks replay")

    def test_authorized_success_requires_durable_atomic_claim(self) -> None:
        self.run_node("AC-V2-03: same-adapter concurrency serialized with documented boundary")

    def test_safari_mirror_and_sanitized_errors(self) -> None:
        self.run_node("AC-V2-04: Safari mirror and sanitized adapter errors")


if __name__ == "__main__":
    unittest.main()
