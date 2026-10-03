#!/usr/bin/env python3
from __future__ import annotations
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def run_node(mode: str) -> str:
    return subprocess.run(
        ["node", str(ROOT / "test-factory-control-runtime.cjs"), mode],
        cwd=ROOT, check=True, text=True, capture_output=True, timeout=90,
    ).stdout

class FactoryControlInstanceRuntimeTests(unittest.TestCase):
    def test_pause_resume_persist_before_fanout_and_require_all_tabs(self) -> None:
        self.assertIn("persist-before-fanout and duplicate-safe", run_node("instance-happy"))

    def test_wrong_instance_revoked_expired_partial_and_duplicate_fail_closed(self) -> None:
        self.assertIn("wrong-instance revoked and expired fail closed", run_node("instance-failclosed"))
        self.assertIn("duplicate-safe", run_node("instance-happy"))

    def test_reconcile_uses_master_state_without_remote_io(self) -> None:
        self.assertIn("reconcile follows local master state", run_node("instance-reconcile"))

    def test_wrong_instance_returns_not_found_with_zero_effects(self) -> None:
        self.assertIn(
            "wrong instance returns not_found with zero effects",
            run_node("instance-failclosed"),
        )

    def test_partial_failure_sets_reconciliation_pending_until_full_reconcile(self) -> None:
        self.assertIn(
            "partial failure sets reconciliation pending until full reconcile",
            run_node("instance-reconcile"),
        )

    def test_duplicate_receipt_still_does_not_reapply_after_status_repair(self) -> None:
        self.assertIn(
            "duplicate receipt does not reapply after status repair",
            run_node("instance-happy"),
        )

    def test_legacy_runtime_regressions_remain_in_all_mode(self) -> None:
        output = run_node("all")
        self.assertIn("factory-control runtime lifecycle: ok", output)
        self.assertIn("reconcile follows local master state", output)

if __name__ == "__main__":
    unittest.main()
