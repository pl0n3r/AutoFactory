"""Acceptance checks for the offline AutoFactory command executor.

AC-01 and AC-02 reuse the actual Node execution suite. AC-03 is deliberately
not claimed here until the ledger path is part of the canonical reservation.
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


if __name__ == "__main__":
    unittest.main()
