"""Executable acceptance for AutoFactory #156; all transport calls use Node fakes."""
from __future__ import annotations
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class FactoryControlLocalPublisherTests(unittest.TestCase):
    def check_node(self, case: str) -> None:
        done = subprocess.run(
            ["node", "test-factory-control-local-publisher.cjs", case],
            cwd=ROOT, capture_output=True, text=True, timeout=25, check=False,
        )
        self.assertEqual(done.returncode, 0, done.stdout + "\n" + done.stderr)

    def test_ac01_contract_keys_only(self):
        self.check_node("ac01")

    def test_ac02_never_transmit_chat_content_or_account_ids(self):
        self.check_node("ac02")

    def test_ac03_disabled_switch_never_sends(self):
        self.check_node("ac03")

    def test_ac04_local_failure_backoff_isolated(self):
        self.check_node("ac04")

    def test_ac05_limit_and_logged_out_reset_time(self):
        self.check_node("ac05")

    def test_ac06_idle_reason_enum_and_idle_since(self):
        self.check_node("ac06")


if __name__ == "__main__":
    unittest.main()
