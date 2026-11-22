"""Regression guard for three authenticated SonarCloud S2871 findings."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
CASES = (
    ('test-factory-control-local-chats.cjs', 'Object.keys(out.chats[0]).sort((a, b) => a.localeCompare(b))'),
    ('test-factory-control-executor.cjs', '[one.code, two.code].sort((a, b) => a.localeCompare(b))'),
    ('test-factory-control-ledger.cjs', 'result.map(x => x.code).sort((a, b) => a.localeCompare(b))'),
)


class HallazgosSonarResueltosTests(unittest.TestCase):
    def test_criterio_principal(self):
        for filename, expected in CASES:
            with self.subTest(filename=filename):
                self.assertIn(expected, (ROOT / filename).read_text(encoding='utf-8'))
        result = subprocess.run(
            ['node', '-e', "const a = require('node:assert/strict'); "
             "const values = ['z', 'a', 'b']; "
             "a.deepEqual(values.sort((x,y)=>x.localeCompare(y)), ['a','b','z']);"],
            cwd=ROOT, capture_output=True, text=True, timeout=20, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr[:300])
