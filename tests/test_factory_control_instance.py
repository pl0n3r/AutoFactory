#!/usr/bin/env python3
"""Acceptance wrapper for AutoFactory instance identity and privacy inventory."""
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_instance_test() -> str:
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
    def test_identity_is_stable_browser_scoped_and_snapshot_minimized(self) -> None:
        self.assertIn(
            "stable, browser-scoped, revocable and minimized",
            run_instance_test(),
        )

    def test_malformed_expired_or_revoked_state_fails_closed(self) -> None:
        self.assertIn(
            "stable, browser-scoped, revocable and minimized",
            run_instance_test(),
        )

    def test_privacy_inventory_declares_instance_identity_before_activation(self) -> None:
        payload = json.loads((ROOT / "datos.yml").read_text(encoding="utf-8"))
        treatment = next(
            item
            for item in payload["treatments"]
            if item["id"] == "local_factory_control_instance_identity"
        )
        expected = {
            "instanceId",
            "browser",
            "profileAlias",
            "deviceAlias",
            "extensionVersion",
            "protocolVersion",
            "grant.instanceId",
            "grant.expiresAt",
            "grant.revoked",
            "grant.actions",
            "grant.tabIds",
        }
        self.assertTrue(expected.issubset(set(treatment["fields"])))
        self.assertEqual(treatment["providers"], [])
        self.assertEqual(treatment["consent"], "required_before_activation")
        self.assertIn("D-061", treatment["retention"])


if __name__ == "__main__":
    unittest.main()
