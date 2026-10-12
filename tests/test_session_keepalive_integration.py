"""Factory #173: execute real Node suites for the offline admission guard."""
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
NODE_SUITE = ROOT / 'test-session-keepalive-runtime.cjs'


class SessionKeepaliveIntegrationTests(unittest.TestCase):
    def run_node(self, case):
        result = subprocess.run(
            ['node', '--test', f'--test-name-pattern={case}', str(NODE_SUITE)],
            cwd=ROOT, capture_output=True, text=True, timeout=20, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
        self.assertIn('pass 1', result.stdout, result.stdout)

    def test_ac01_default_disabled_and_revocation(self):
        self.run_node('AC-01')

    def test_ac02_two_phase_stale_evidence_blocks(self):
        self.run_node('AC-02')

    def test_ac03_concurrent_candidates_fail_closed(self):
        self.run_node('AC-03')

    def test_ac04_no_runtime_send_or_private_output(self):
        self.run_node('AC-04')
