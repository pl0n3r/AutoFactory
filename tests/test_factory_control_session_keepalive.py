"""Factory #163: acceptance bridge to offline Node tests (no browser or network)."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE_TEST = ROOT / "test-factory-control-session-keepalive.cjs"


class SessionKeepAliveTests(unittest.TestCase):
    def run_node(self, criterion: str) -> None:
        result = subprocess.run(
            ["node", str(NODE_TEST), criterion],
            cwd=ROOT, text=True, capture_output=True, timeout=20, check=False
        )
        self.assertEqual(result.returncode, 0,
                         f"{criterion}: {result.stdout[-500:]} {result.stderr[-500:]}")

    def test_ac01_pacing_and_bounded_reengagement(self):
        self.run_node("AC-01")

    def test_ac02_account_budget_and_stop_reasons(self):
        self.run_node("AC-02")


if __name__ == "__main__":
    unittest.main()
