"""Acceptance wrappers for AutoFactory #167 pure LAN command tests.

The Node scenarios use injected fakes and do not access a real network.
"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class FactoryControlLocalCommandsTests(unittest.TestCase):
    def case(self, name: str) -> None:
        result = subprocess.run(
            ["node", "test-factory-control-local-commands.cjs", name],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + "\n" + result.stderr)

    def test_ac01_private_hosts_only(self):
        self.case("ac01")

    def test_ac02_disabled_never_uses_network(self):
        self.case("ac02")

    def test_ac03_agent_key_never_leaks_to_payload_or_log(self):
        self.case("ac03")

    def test_ac04_global_stop_start_dedup_and_ack(self):
        self.case("ac04")

    def test_ac05_start_does_not_override_usage_or_login(self):
        self.case("ac05")

    def test_ac06_fail_closed_backoff_and_autopilot_isolation(self):
        self.case("ac06")


if __name__ == "__main__":
    unittest.main()
