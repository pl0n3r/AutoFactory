#!/usr/bin/env python3
"""Acceptance tests for Factory Control background wiring build-ahead."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAFARI = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"

MODULES = [
    "factory-control-protocol.js",
    "factory-control-authorization.js",
    "factory-control-ledger.js",
    "factory-control-instance.js",
    "factory-control-runtime.js",
]


class FactoryControlBackgroundWiringTests(unittest.TestCase):
    def test_instance_runtime_modules_load_but_feature_is_disabled_by_default(self) -> None:
        entry = (ROOT / "background-entry.js").read_text()
        background = (ROOT / "background.js").read_text()

        for module in MODULES:
            self.assertIn(f"'{module}'", entry)
            self.assertEqual(
                (ROOT / module).read_bytes(),
                (SAFARI / module).read_bytes(),
            )

        self.assertEqual(
            (ROOT / "background-entry.js").read_bytes(),
            (SAFARI / "background-entry.js").read_bytes(),
        )
        self.assertEqual(
            (ROOT / "background.js").read_bytes(),
            (SAFARI / "background.js").read_bytes(),
        )
        self.assertIn(
            "const FACTORY_CONTROL_INSTANCE_RUNTIME_ENABLED = false;",
            background,
        )
        self.assertIn(
            "if (!FACTORY_CONTROL_INSTANCE_RUNTIME_ENABLED) return null;",
            background,
        )
        self.assertIn(
            "createInstanceRuntime",
            background,
        )

    def test_manifest_permissions_and_origins_do_not_expand(self) -> None:
        manifest = json.loads((ROOT / "manifest.json").read_text())
        safari_manifest = json.loads((SAFARI / "manifest.json").read_text())

        expected_permissions = ["activeTab", "storage", "tabs", "alarms"]
        expected_hosts = ["https://chatgpt.com/*"]
        self.assertEqual(manifest["permissions"], expected_permissions)
        self.assertEqual(manifest["host_permissions"], expected_hosts)
        self.assertEqual(safari_manifest["permissions"], expected_permissions)
        self.assertEqual(safari_manifest["host_permissions"], expected_hosts)

    def test_wiring_has_no_controlbot_endpoint_or_remote_transport(self) -> None:
        combined = "\n".join(
            (ROOT / name).read_text()
            for name in ["background-entry.js", "background.js"]
        )
        self.assertNotIn("control.condorapp.com.co", combined)
        self.assertNotIn("fetch(", combined)
        self.assertNotIn("XMLHttpRequest", combined)
        self.assertNotIn("WebSocket", combined)
        self.assertNotIn("factory-control-transport.js", combined)
        self.assertNotIn("factory-control-pairing.js", combined)


if __name__ == "__main__":
    unittest.main()
