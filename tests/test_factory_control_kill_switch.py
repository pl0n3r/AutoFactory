"""Executable acceptance bridge for AutoFactory#157's isolated Node contract.

Runs a local fake-only suite; never accesses GitHub, browser profiles, or network.
"""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "test-factory-control-kill-switch.cjs"


class KillSwitchTests(unittest.TestCase):
    def run_fake_suite(self, expected):
        outcome = subprocess.run(
            ["node", str(SCRIPT)], cwd=ROOT, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=15, check=False,
        )
        self.assertEqual(outcome.returncode, 0, outcome.stdout[-2500:])
        self.assertIn(expected, outcome.stdout)
        self.assertNotIn("PRIVATE-TOKEN", outcome.stdout)
        self.assertNotIn("PRIVATE-CHAT", outcome.stdout)

    def test_ac01_kill_fences_inflight(self):
        self.run_fake_suite("AF157-AC01-ABORT-INFLIGHT-OK")

    def test_ac02_rollback_redacted(self):
        self.run_fake_suite("AF157-AC02-ROLLBACK-REDACTED-OK")

    def test_ac03_no_new_commands(self):
        self.run_fake_suite("AF157-AC03-NO-NEW-COMMANDS-OK")


if __name__ == "__main__":
    unittest.main()
