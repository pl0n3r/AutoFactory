#!/usr/bin/env python3
"""Factory AC harness: execute the real Node.js offline heartbeat simulation.

These tests are the executable acceptance bridge; they never replace the
JavaScript coordinator, mock a result, open a browser or use a network port.
"""
from __future__ import annotations

from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "test-factory-control-heartbeat-fakeclock.cjs"


def run_real_node(scenario: str) -> None:
    result = subprocess.run(
        ["node", str(SCRIPT), scenario],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=25,
    )
    if result.returncode:
        raise AssertionError(
            f"Offline heartbeat scenario {scenario} failed:\n"
            f"stdout={result.stdout[-1500:]}\nstderr={result.stderr[-2500:]}"
        )
    expected = f"heartbeat-fakeclock {scenario}: ok"
    if expected not in result.stdout.splitlines():
        raise AssertionError(f"Missing real-Node acceptance evidence: {scenario}")


class HeartbeatFakeclockAcceptanceTests(unittest.TestCase):
    def test_cadence_reconnection(self) -> None:
        run_real_node("cadence")

    def test_revocation_replay(self) -> None:
        run_real_node("revocation")

    def test_unknown_input_fail_closed(self) -> None:
        run_real_node("unknown")

    def test_backoff_no_side_effects(self) -> None:
        run_real_node("backoff")


if __name__ == "__main__":
    unittest.main()
