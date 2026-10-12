"""AutoFactory #155: public pairing results never expose opaque credential handles.

Every target executes the real Node contract with synthetic adapters and no network.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


def run_pairing_contract() -> str:
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "FACTORY_PAIRING_PYTHON_CHILD": "1"}
    result = subprocess.run(
        ["node", "test-factory-control-pairing.cjs"],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=30, check=False,
    )
    if result.returncode != 0:
        raise AssertionError("offline pairing contract failed")
    return result.stdout


class PairingPublicResultTests(unittest.TestCase):
    def test_success_response_excludes_opaque_credential(self):
        self.assertIn("pairing-public AC-01..04: ok", run_pairing_contract())

    def test_internal_persistence_retains_revocable_handle(self):
        self.assertIn("pairing-audit AC-01: ok", run_pairing_contract())

    def test_failure_and_compensation_results_are_sanitized(self):
        self.assertIn("pairing-public AC-01..04: ok", run_pairing_contract())

    def test_existing_pairing_contract_and_public_boundary(self):
        self.assertIn("factory-control pairing contract: ok", run_pairing_contract())


if __name__ == "__main__":
    unittest.main()
