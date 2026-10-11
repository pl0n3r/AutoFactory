"""#161: exercise the real JS guard and Chrome/Safari byte parity offline."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAFARI_GUARD = ROOT / "safari/ChatGPT Autopilot Local Extension/Resources/account-budget-guard.js"


class AutopilotBudgetRefreshRevokeTests(unittest.TestCase):
    def run_node_guard(self, marker: str) -> None:
        result = subprocess.run(
            ["node", "test-account-budget-guard.cjs"], cwd=ROOT,
            capture_output=True, text=True, timeout=30, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout[-3000:] + result.stderr[-3000:])
        self.assertIn(marker, result.stdout)

    def test_failed_status_revokes_authorized_send_immediately(self) -> None:
        self.run_node_guard("AF161-FAILED-STATUS-REVOKES")

    def test_invalid_snapshot_and_refresh_races_fail_closed(self) -> None:
        self.run_node_guard("AF161-RACES-FAIL-CLOSED")

    def test_healthy_budget_and_safari_parity(self) -> None:
        self.assertEqual((ROOT / "account-budget-guard.js").read_bytes(), SAFARI_GUARD.read_bytes())
        self.run_node_guard("AF161-HEALTHY")


if __name__ == "__main__":
    unittest.main()
