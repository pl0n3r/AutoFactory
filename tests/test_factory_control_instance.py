#!/usr/bin/env python3
"""Acceptance tests for the local Factory Control instance identity slice."""
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_node() -> str:
    result = subprocess.run(
        ["node", str(ROOT / "test-factory-control-instance.cjs")],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
        timeout=90,
    )
    return result.stdout


class FactoryControlInstanceTests(unittest.TestCase):
    def test_instance_identity_is_stable_browser_scoped_and_data_minimized(self) -> None:
        output = run_node()
        self.assertIn(
            "Factory Control instance identity: stable, browser-scoped and data-minimized",
            output,
        )

    def test_grant_is_expiring_revocable_and_malformed_state_fails_closed(self) -> None:
        output = run_node()
        self.assertIn(
            "Factory Control instance grant: expiring, revocable and fail-closed",
            output,
        )

    def test_privacy_inventory_declares_instance_identity_without_remote_provider(self) -> None:
        inventory = json.loads((ROOT / "datos.yml").read_text())
        treatment = next(
            row for row in inventory["treatments"]
            if row["id"] == "local_factory_control_instance_identity"
        )
        self.assertEqual(treatment["providers"], [])
        self.assertEqual(treatment["consent"], "required_before_activation")
        self.assertEqual(
            set(treatment["fields"]),
            {
                "instanceId",
                "browser",
                "profileAlias",
                "deviceAlias",
                "extensionVersion",
                "protocolVersion",
                "grant.id",
                "grant.actions",
                "grant.expiresAt",
                "grant.revoked",
            },
        )


if __name__ == "__main__":
    unittest.main()
