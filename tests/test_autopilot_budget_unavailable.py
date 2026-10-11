"""Acceptance regressions exercising the real Node guard/content tests."""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_node(name: str) -> None:
    result = subprocess.run(
        ["node", name], cwd=ROOT, capture_output=True, text=True,
        timeout=25, check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"{name} failed ({result.returncode}):\n"
            f"{result.stdout[-3000:]}\n{result.stderr[-3000:]}"
        )


class AutopilotBudgetUnavailableTests(unittest.TestCase):
    def test_disabled_budget_preserves_local_send_path(self):
        run_node("test-account-budget-guard.cjs")

    def test_invalid_snapshot_deadline_fails_closed(self):
        run_node("test-account-budget-guard.cjs")

    def test_content_recovery_is_auditable_and_no_duplicate_send(self):
        run_node("test-account-budget-content.cjs")


if __name__ == "__main__":
    unittest.main()
