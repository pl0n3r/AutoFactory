"""Executable acceptance for AutoFactory #152: run the real Node background harness."""
from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class AutopilotSendDiagnosticPrivacyTests(unittest.TestCase):
    def _run_node(self, marker: str) -> None:
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node 20+ required; no synthetic success")
        result = subprocess.run(
            [node, "test-background.cjs"], cwd=ROOT,
            text=True, capture_output=True, check=False, timeout=35,
        )
        output = result.stdout + "\n" + result.stderr
        self.assertEqual(result.returncode, 0, output[-7000:])
        self.assertIn(marker, result.stdout, output[-7000:])
        self.assertIn("AF152-GETLOG-ERROR-REDACTED", result.stdout, output[-7000:])

    def test_missing_send_control_retains_only_bounded_counts(self) -> None:
        self._run_node("AF152-COUNTS-OK")

    def test_sensitive_fields_and_malformed_nested_input_are_rejected(self) -> None:
        self._run_node("AF152-PRIVACY-OK")

    def test_chrome_safari_background_mirror_and_legacy_redaction(self) -> None:
        self._run_node("AF152-MIRROR-LEGACY-OK")


if __name__ == "__main__":
    unittest.main()
