"""Factory v1 acceptance adapter for the approved offline Node tests."""

from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LocalTabProgressTests(unittest.TestCase):
    def _run_node(self, case):
        result = subprocess.run(
            ["node", "test-local-tab-progress.cjs", case],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 offline acceptance test(s) passed", result.stdout)

    def test_no_progress_requires_threshold_and_stable_fingerprint(self):
        self._run_node("AC-01")

    def test_fresh_activity_resets_state_and_excludes_chat_payload(self):
        self._run_node("AC-02")


if __name__ == "__main__":
    unittest.main()
