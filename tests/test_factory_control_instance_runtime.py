#!/usr/bin/env python3
"""Acceptance tests for the build-ahead instance runtime slice."""
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAFARI_BACKGROUND = (
    ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources" / "background.js"
)


def run_node() -> str:
    result = subprocess.run(
        ["node", str(ROOT / "test-factory-control-instance-runtime.cjs")],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
        timeout=90,
    )
    return result.stdout


class FactoryControlInstanceRuntimeTests(unittest.TestCase):
    def test_pause_resume_persists_before_fanout_and_wrong_instance_has_zero_effects(self) -> None:
        output = run_node()
        self.assertIn(
            "Factory instance runtime: persistence precedes fan-out and wrong-instance is effect-free",
            output,
        )

    def test_duplicate_partial_failure_and_reconcile_are_idempotent_and_fail_closed(self) -> None:
        output = run_node()
        self.assertIn(
            "Factory instance runtime: duplicates, partial failure and reconcile are fail-closed",
            output,
        )

    def test_background_hook_remains_disabled_without_network_or_permission_expansion(self) -> None:
        root_background = (ROOT / "background.js").read_text()
        safari_background = SAFARI_BACKGROUND.read_text()
        manifest = json.loads((ROOT / "manifest.json").read_text())

        self.assertEqual(root_background, safari_background)
        self.assertIn("controlBridgeEnabled: false", root_background)
        self.assertIn("runtimeFactory: 'createInstanceRuntime'", root_background)
        self.assertNotIn("control.condorapp.com.co", root_background)
        self.assertNotIn("fetch(", root_background)
        self.assertEqual(
            manifest["permissions"],
            ["activeTab", "storage", "tabs", "alarms"],
        )
        self.assertEqual(
            manifest["host_permissions"],
            ["https://chatgpt.com/*"],
        )


if __name__ == "__main__":
    unittest.main()
