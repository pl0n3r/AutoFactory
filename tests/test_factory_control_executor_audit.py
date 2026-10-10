"""Acceptance checks for the offline AutoFactory command executor.

All three criteria execute the real JavaScript suite with memory-only adapters.
No real messaging, accounts, browser extensions or services are involved.
"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_executor_contract() -> str:
    result = subprocess.run(
        ["node", "test-factory-control-executor.cjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    if result.returncode != 0:
        raise AssertionError(
            "Offline Node executor contract failed; inspect exact-HEAD CI"
        )
    return result.stdout


class FactoryControlExecutorAuditTests(unittest.TestCase):
    def test_authorized_command_is_idempotent_with_persisted_receipt(self):
        self.assertIn(
            "authorization, durable idempotency, effect isolation and safe ACKs pass",
            run_executor_contract(),
        )

    def test_invalid_or_unauthorized_command_fails_closed(self):
        self.assertIn(
            "Factory Control executor: authorization",
            run_executor_contract(),
        )


    def test_sanitized_audit_survives_recreation_and_failures(self):
        self.assertIn(
            "Factory Control audit AC-03: sanitized durable decisions,"
            " fail-closed pending and replay rejection pass",
            run_executor_contract(),
        )
        result = subprocess.run(
            ["node", "test-factory-control-ledger.cjs"],
            cwd=ROOT, capture_output=True, text=True, check=False, timeout=30,
        )
        self.assertEqual(result.returncode, 0, "Offline ledger regression failed")
        self.assertIn(
            "Factory Control ledger AC-03: ambiguous result stays pending",
            result.stdout,
        )


if __name__ == "__main__":
    unittest.main()
