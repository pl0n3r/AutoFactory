#!/usr/bin/env python3
"""Acceptance tests for the disabled local Factory Control instance runtime."""
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_node(mode: str) -> str:
    result = subprocess.run(
        ["node", str(ROOT / "test-factory-control-runtime.cjs"), mode],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
        timeout=90,
    )
    return result.stdout


class FactoryControlInstanceRuntimeTests(unittest.TestCase):
    def test_pause_resume_persist_before_fanout_and_require_all_tabs(self) -> None:
        self.assertIn(
            "persist-before-fanout and duplicate-safe",
            run_node("instance-happy"),
        )

    def test_wrong_instance_revoked_expired_partial_and_duplicate_fail_closed(self) -> None:
        self.assertIn(
            "wrong-instance revoked and expired fail closed",
            run_node("instance-failclosed"),
        )
        self.assertIn(
            "persist-before-fanout and duplicate-safe",
            run_node("instance-happy"),
        )

    def test_background_integration_is_disabled_and_adds_no_network_or_permissions(self) -> None:
        background = (ROOT / "background.js").read_text()
        entry = (ROOT / "background-entry.js").read_text()
        manifest = json.loads((ROOT / "manifest.json").read_text())
        self.assertIn("FACTORY_CONTROL_INSTANCE_RUNTIME_ENABLED = false", background)
        self.assertIn("initializeFactoryControlInstanceRuntime", background)
        self.assertIn("'factory-control-runtime.js'", entry)
        self.assertEqual(
            manifest["permissions"],
            ["activeTab", "storage", "tabs", "alarms"],
        )
        self.assertEqual(manifest["host_permissions"], ["https://chatgpt.com/*"])
        self.assertNotIn("https://control.condorapp.com.co", background)

    def test_reconcile_uses_master_state_without_remote_io(self) -> None:
        self.assertIn(
            "reconcile follows local master state",
            run_node("instance-reconcile"),
        )


if __name__ == "__main__":
    unittest.main()
