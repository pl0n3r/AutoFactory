"""Executable acceptance for owner-approved, fixture-only local status presentation."""
from pathlib import Path
import json
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "popup.html"
JS = ROOT / "popup.js"
SAFARI = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"
START = "// LOCAL_PROGRESS_VIEW_START"
END = "// LOCAL_PROGRESS_VIEW_END"


class LocalProgressPresentationTests(unittest.TestCase):
    def _snippet(self):
        js = JS.read_text(encoding="utf-8")
        self.assertEqual(js.count(START), 1)
        self.assertEqual(js.count(END), 1)
        return js[js.index(START):js.index(END) + len(END)]

    def _render(self, value):
        runner = r"""
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('popup.js', 'utf8');
const start = '// LOCAL_PROGRESS_VIEW_START';
const end = '// LOCAL_PROGRESS_VIEW_END';
const fragment = source.slice(source.indexOf(start), source.indexOf(end) + end.length);
const toggled = {};
const node = {textContent:'', dataset:{}, classList:{toggle(key,enabled){toggled[key]=enabled;}}};
const input = JSON.parse(process.argv[1]);
const context = { $: (id) => id === 'local-progress-status' ? node : null };
const state = vm.runInNewContext(fragment + '\nrenderLocalTabProgress(' + JSON.stringify(input) + ');', context, {timeout:1000});
process.stdout.write(JSON.stringify({state, text:node.textContent, dataState:node.dataset.state, toggled}));
"""
        completed = subprocess.run(["node", "-e", runner, json.dumps(value)], cwd=ROOT,
                                   capture_output=True, text=True, timeout=12, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)

    def test_offline_state_labels_without_chat_payload(self):
        markup = HTML.read_text(encoding="utf-8")
        self.assertIn('id="local-progress-card"', markup)
        self.assertIn('id="local-progress-status"', markup)
        self.assertIn('aria-live="polite"', markup)
        self.assertIn('role="status"', markup)
        self.assertIn('tabindex="0"', markup.split('id="local-progress-card"')[1].split('</section>',1)[0].lower())
        for fixture, label in [("ACTIVA", "ACTIVA"), ("SIN_AVANCE", "SIN AVANCE"), ("UNKNOWN", "UNKNOWN")]:
            with self.subTest(fixture=fixture):
                result = self._render(fixture)
                self.assertEqual(result["state"], fixture)
                self.assertTrue(result["text"].startswith(label))
                self.assertEqual(result["dataState"], fixture)
        hostile = self._render('<img src=x onerror=alert(1)>')
        self.assertEqual(hostile["state"], "UNKNOWN")
        self.assertNotIn('img', hostile["text"])
        fragment = self._snippet()
        self.assertIn('textContent =', fragment)
        self.assertNotIn('innerHTML', fragment)
        for forbidden in ('chrome.', '.tabs.', '.storage.', 'sendMessage', 'fetch(', 'cookie', 'conversation', 'localStorage', 'addEventListener', 'setTimeout', 'setInterval'):
            self.assertNotIn(forbidden, fragment)

    def test_unknown_and_disabled_without_runtime_or_network(self):
        markup = HTML.read_text(encoding="utf-8")
        self.assertIn('UNKNOWN · sin fuente conectada', markup)
        self.assertIn('Vista sintética, sin datos conectados', markup)
        for value in (None, False, 0, [], {}, ['ACTIVA', 'ACTIVA'], ['ACTIVA'], 'no-autorizado', ''):
            with self.subTest(value=value):
                result = self._render(value)
                self.assertEqual(result["state"], "UNKNOWN")
                self.assertTrue(result["toggled"]["paused"])
                self.assertFalse(result["toggled"]["active"])
        self.assertIn('renderLocalTabProgress();', self._snippet())

    def test_popup_source_mirrors_safari(self):
        for filename in ("popup.html", "popup.js"):
            self.assertEqual((ROOT / filename).read_bytes(), (SAFARI / filename).read_bytes(), filename)


if __name__ == '__main__':
    unittest.main()
