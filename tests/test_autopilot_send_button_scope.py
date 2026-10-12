"""Executable regression wrappers for AutoFactory #145's real Node DOM tests."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class AutopilotSendButtonScopeTests(unittest.TestCase):
    def run_node_case(self, name):
        result = subprocess.run(
            ["node", "test-core.cjs", f"--send-button-case={name}"],
            cwd=ROOT, capture_output=True, text=True, timeout=40, check=False,
        )
        self.assertEqual(
            result.returncode, 0,
            f"Node DOM regression {name} failed:\n{result.stderr[-1600:]}"
        )

    def test_prefers_visible_enabled_composer_button(self):
        self.run_node_case("prefers_visible_enabled_composer_button")

    def test_unrelated_or_unsafe_controls_fail_closed(self):
        self.run_node_case("unrelated_or_unsafe_controls_fail_closed")

    def test_normal_composer_backward_compatibility(self):
        self.run_node_case("normal_composer_backward_compatibility")


if __name__ == "__main__":
    unittest.main()
