"""#286: verify the real offline Node bridge chain; no browser or network."""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "test-factory-control-bridge-e2e-synthetic.cjs"
DOC = ROOT / "docs/bridge-e2e-synthetic-fixtures.md"


def execute_node() -> str:
    result = subprocess.run(
        ["node", SCRIPT.name], cwd=ROOT, capture_output=True,
        text=True, timeout=35, check=False,
    )
    if result.returncode != 0:
        # Redacted failure: stdout/stderr are never copied into logs.
        raise AssertionError("Synthetic bridge E2E Node assertions failed")
    return result.stdout


class BridgeE2ESyntheticTests(unittest.TestCase):
    def test_full_synthetic_chain_with_replay(self) -> None:
        output = execute_node()
        self.assertIn(
            "bridge-e2e AC-01: full fake chain + lost ACK replay: PASS",
            output,
        )
        self.assertIn(
            "bridge-e2e AC-02: fail-closed, no real transport, rollback: PASS",
            output,
        )
        self.assertLess(output.index("bridge-e2e AC-01"), output.index("bridge-e2e AC-02"))
        self.assertTrue(DOC.is_file())
        self.assertIn("No es E2E live", DOC.read_text(encoding="utf-8"))

    def test_rollback_no_real_transport_or_data(self) -> None:
        output = execute_node()
        self.assertIn("fail-closed, no real transport, rollback: PASS", output)
        source = SCRIPT.read_text(encoding="utf-8")
        for prohibited in (
            "fetch(", "XMLHttpRequest", "WebSocket(", "https.request(",
            "http.request(", "chrome.tabs", "browser.tabs", "localStorage.",
            "document.querySelector(", "child_process", "process.env.",
        ):
            self.assertNotIn(prohibited, source)
        self.assertIn("createFactoryControlKillSwitch(", source)
        self.assertIn("rollback_failed", source)
        self.assertIn("already_handled", source)
        self.assertNotIn("fixture_chain_01", output)
        self.assertNotIn("sample-profile", output)
        self.assertNotIn("123456", output)


if __name__ == "__main__":
    unittest.main()
