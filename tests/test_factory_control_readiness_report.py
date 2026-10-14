"""Factory #158 acceptance bridge: exercise the actual offline Node fixtures."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent
NODE_TEST = ROOT / "test-factory-control-readiness-report.cjs"


class ReadinessReportTests(unittest.TestCase):
    def run_node(self, criterion: str) -> None:
        completed = subprocess.run(
            ["node", str(NODE_TEST), criterion],
            cwd=ROOT, capture_output=True, text=True, timeout=30, check=False
        )
        self.assertEqual(
            completed.returncode, 0,
            f"{criterion}: {completed.stdout[-500:]} {completed.stderr[-500:]}"
        )

    def test_ac01_unknown_reason_and_freshness(self):
        self.run_node("AC-01")

    def test_ac02_redacts_private_fields(self):
        self.run_node("AC-02")

    def test_ac03_stale_signals_fail_closed(self):
        self.run_node("AC-03")


if __name__ == "__main__":
    unittest.main()
