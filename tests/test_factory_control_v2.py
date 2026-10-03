#!/usr/bin/env python3
"""Factory Control v2 acceptance wrapper over the canonical Node regressions."""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_node(script: str) -> str:
    result = subprocess.run(
        ["node", str(ROOT / script)],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
        timeout=90,
    )
    return result.stdout


class FactoryControlV2Tests(unittest.TestCase):
    def test_v2_protocol_rejects_private_extra_or_cross_instance_shapes(self) -> None:
        output = run_node("test-factory-control.cjs")
        self.assertIn(
            "Factory Control v2 protocol: exact, instance-scoped and data-minimized",
            output,
        )

    def test_v2_authorization_and_ledger_are_instance_scoped_expiring_and_idempotent(self) -> None:
        output = run_node("test-factory-control-ledger.cjs")
        self.assertIn(
            "Factory Control v2 authorization and ledger: instance-scoped, expiring and idempotent",
            output,
        )


if __name__ == "__main__":
    unittest.main()
