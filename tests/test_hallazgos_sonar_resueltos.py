"""Regression coverage for authenticated SonarCloud Reliability findings (#428)."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
CASES = (
    ('test-factory-control-local-chats.cjs', 'Object.keys(out.chats[0]).sort((a, b) => a.localeCompare(b))'),
    ('test-factory-control-executor.cjs', '[one.code, two.code].sort((a, b) => a.localeCompare(b))'),
    ('test-factory-control-ledger.cjs', 'result.map(x => x.code).sort((a, b) => a.localeCompare(b))'),
)
MIRRORS = (
    ('autopilot-core.js', 'safari/ChatGPT Autopilot Local Extension/Resources/autopilot-core.js'),
    ('popup.js', 'safari/ChatGPT Autopilot Local Extension/Resources/popup.js'),
)


class HallazgosSonarResueltosTests(unittest.TestCase):
    def test_criterio_principal(self):
        for filename, expected in CASES:
            with self.subTest(filename=filename):
                self.assertIn(expected, (ROOT / filename).read_text(encoding='utf-8'))
        for chrome, safari in MIRRORS:
            with self.subTest(mirror=chrome):
                self.assertEqual((ROOT / chrome).read_bytes(), (ROOT / safari).read_bytes())
        core = (ROOT / 'autopilot-core.js').read_text(encoding='utf-8')
        popup = (ROOT / 'popup.js').read_text(encoding='utf-8')
        # New Code MEDIUM: S8786 must not use nested ambiguous model regex.
        self.assertIn('const tokens = normalize(value)', core)
        self.assertNotIn(r'gpt\s*-?\s*', core)
        # S9383: the best-effort settings migration must observe Promise rejection.
        self.assertIn('void extensionApi.storage.local.set({settingsDefaultVersion:', popup)
        self.assertIn('})?.catch?.(() => {', popup)
        self.assertIn('void extensionApi.storage.local.get(DEFAULTS, values => {', popup)
        self.assertIn('No se pudieron cargar los ajustes', popup)
        node_program = r"""
const assert = require('node:assert/strict');
const core = require('./autopilot-core.js');
assert.deepEqual(['z', 'a', 'b'].sort((x, y) => x.localeCompare(y)), ['a', 'b', 'z']);
const samples = [
  ['GPT-6', 'gpt-6'], ['GPT6', 'gpt-6'], ['GPT - 6', 'gpt-6'],
  ['GPT-5.6 Sol', 'gpt-5.6-sol'], ['GPT 5.6 Sol', 'gpt-5.6-sol'],
  ['GPT - 5.6 Sol', 'gpt-5.6-sol'], ['GPT5.6 Sol', 'gpt-5.6-sol'],
  ['GPT-6 GPT 5.6 Sol', 'gpt-5.6-sol'],
  ['GPT-7', null], ['High', null], ['xGPT6', null],
  ['GPT---6', null], ['GPT- -6', null], ['GPT - -6', null], ['GPT-5.6', null]
];
for (const [input, expected] of samples) {
  assert.equal(core.modelIdFromText(input), expected, input);
}
assert.equal(core.modelIdFromText('gpt - '.repeat(4000) + 'GPT - 5.6 Sol'),
  'gpt-5.6-sol');

// Exercise the actual popup migration callback with Promise and callback-only APIs.
const fs = require('node:fs');
const vm = require('node:vm');
const popup = fs.readFileSync('popup.js', 'utf8');
const begin = popup.indexOf('extensionApi.storage.local.get(DEFAULTS, values => {');
const end = popup.indexOf('  const savedPrompt=', begin);
assert.ok(begin >= 0 && end > begin, 'migration callback should be discoverable');
const migration = popup.slice(begin, end) + '});';
function runMigration(write, messages) {
  const context = {
    DEFAULTS: {}, SETTINGS_DEFAULT_VERSION: 2,
    extensionApi: {storage: {local: {
      get: (_defaults, callback) => callback({settingsDefaultVersion: 0}),
      set: write
    }}},
    showStatus: message => messages.push(message)
  };
  vm.runInNewContext(migration, context);
}
const callbackMessages = [];
runMigration(() => undefined, callbackMessages);
assert.deepEqual(callbackMessages, []);
const rejectedMessages = [];
runMigration(() => Promise.reject(new Error('simulated storage failure')), rejectedMessages);
queueMicrotask(() => {
  assert.equal(rejectedMessages.some(x => x.includes('No se guardaron')), true);
});
"""
        result = subprocess.run(
            ['node', '-e', node_program],
            cwd=ROOT, capture_output=True, text=True, timeout=20, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr[:500])
