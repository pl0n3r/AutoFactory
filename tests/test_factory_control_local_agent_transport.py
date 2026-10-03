#!/usr/bin/env python3
"""Acceptance tests for the disabled local-agent instance transport boundary."""
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAFARI = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"


class FactoryControlLocalAgentTransportTests(unittest.TestCase):
    def _run_node(self) -> str:
        result = subprocess.run(
            ["node", "test-factory-control-instance-transport.cjs"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout

    def test_unauthenticated_invalid_and_oversized_frames_have_zero_effects(self) -> None:
        output = self._run_node()
        self.assertIn("local-agent transport boundary: ok", output)

    def test_authenticated_command_returns_v2_receipt_and_revoked_runtime_result_is_preserved(self) -> None:
        source = (ROOT / "test-factory-control-instance-transport.cjs").read_text()
        self.assertIn("deniedReceipt", source)
        self.assertIn("authenticated: true", source)
        self.assertIn("assert.equal(revoked.effects(), 1)", source)

    def test_reconnect_backoff_is_bounded_and_status_is_content_free(self) -> None:
        source = (ROOT / "factory-control-instance-transport.js").read_text()
        test = (ROOT / "test-factory-control-instance-transport.cjs").read_text()
        self.assertIn("MAX_RETRY_MS = 30_000", source)
        self.assertIn("nextRetryMs", source)
        self.assertIn("serialized.includes(forbidden)", test)
        status_source = source[source.index("function status()"):source.index("function safeFailure")]
        self.assertNotIn("instanceId,", status_source)
        self.assertNotIn("changedAt", status_source)

    def test_background_and_popup_remain_disabled_without_remote_origin_or_permission_expansion(self) -> None:
        module = (ROOT / "factory-control-instance-transport.js").read_text()
        entry = (ROOT / "background-entry.js").read_text()
        background = (ROOT / "background.js").read_text()
        popup = (ROOT / "popup.js").read_text()
        manifest = json.loads((ROOT / "manifest.json").read_text())

        self.assertIn("'factory-control-instance-transport.js'", entry)
        self.assertNotIn("'factory-control-transport.js'", entry)
        self.assertIn("FACTORY_CONTROL_LOCAL_AGENT_ENABLED = false", background)
        self.assertIn("autopilot:factory-control-status", background)
        self.assertIn("autopilot:factory-control-pair", background)
        self.assertIn("autopilot:factory-control-revoke", background)
        self.assertIn("disabled", popup)
        for forbidden in [
            "control.condorapp.com.co", "fetch(", "WebSocket", "XMLHttpRequest",
            "nativeMessaging", "native messaging"
        ]:
            self.assertNotIn(forbidden, module)
            self.assertNotIn(forbidden, background)
        self.assertEqual(
            manifest["permissions"], ["activeTab", "storage", "tabs", "alarms"]
        )
        self.assertEqual(manifest["host_permissions"], ["https://chatgpt.com/*"])

        for name in [
            "factory-control-instance-transport.js",
            "background-entry.js",
            "background.js",
            "popup.html",
            "popup.js",
        ]:
            self.assertEqual((ROOT / name).read_bytes(), (SAFARI / name).read_bytes())


if __name__ == "__main__":
    unittest.main()
