import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAFARI = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"

SCRIPT = r"""
const path = require('path');
const dir = process.argv[1];
const pub = require(path.join(dir, 'factory-control-local-publisher.js'));
const cmd = require(path.join(dir, 'factory-control-local-commands.js'));
const base = { instance_id: 'agent-a', label: 'AutoFactory', state: 'activo', chats_open: 5, idle_reason: 'activo', run_id: 'run-1' };
const ids = ['t969415533', 't1862570850', 't2147483647', 't12345678901', 'tabc', 'x123'];
const payload = pub.payloadFrom({ ...base, chats: ids.map(id => ({ chat_id: id, state: 'generando' })) });
const published = payload.chats.map(c => c.chat_id);
const accepted = ids.filter(id => cmd.globalCommand({ id: 1, chat_id: id, want: 'assign', issue: 'Condor#1' }) !== null);
console.log(JSON.stringify({ published, accepted }));
"""


class TabIdRangeTests(unittest.TestCase):
    def run_node(self, directory: Path) -> dict:
        done = subprocess.run(["node", "-e", SCRIPT, str(directory)], capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        return json.loads(done.stdout.strip().splitlines()[-1])

    def test_ten_digit_tab_ids_are_published_and_accepted_but_longer_ones_are_not(self) -> None:
        for directory in (ROOT, SAFARI):
            with self.subTest(directory=str(directory.relative_to(ROOT)) or "."):
                result = self.run_node(directory)
                good = ["t969415533", "t1862570850", "t2147483647"]
                self.assertEqual(result["published"], good)
                self.assertEqual(result["accepted"], good)


if __name__ == "__main__":
    unittest.main()
