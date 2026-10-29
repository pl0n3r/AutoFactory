"""AutoFactory #398: real offline checks for README 10--13.

Manual installation, external dependencies and organizational policy are not
silently promoted to code coverage. This test never opens a browser or network.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"

OFFLINE = frozenset({"README-10-03", "README-13-01", "README-13-02"})
EXTERNAL = {
    "README-10-01": "npm ci needs a package-registry or pre-populated cache; the full checkout suite is not proven here",
    "README-10-02": "Xcode/Safari packaging requires an actual macOS/Xcode toolchain",
    **{f"README-12-{n:02}": "manual browser installation or macOS/Xcode interaction needs an observed installation smoke"
       for n in range(1, 11)},
}
DECLARATIVE = {
    "README-11-01": "Factory is a governance/kit responsibility, not a local runtime assertion",
    "README-11-02": "ControlBot control-plane ownership is a cross-repository governance statement",
    "README-11-03": "FactoryRunner execution-plane role is a cross-repository governance statement",
    "README-11-04": "product classification of Condor, GrindFlow and BRVTAL is organizational policy",
    "README-11-05": "AutoFactory local/manual ownership is organizational policy",
}
ABSENT: dict[str, str] = {}
EXPECTED = OFFLINE | EXTERNAL.keys() | DECLARATIVE.keys() | ABSENT.keys()

# Each assertion below calls the repository's real JS functions, not a mock
# implementation. Synthetic in-memory storage is deliberate, not browser smoke.
NODE = r"""
'use strict';
const assert = require('node:assert/strict');
const child = require('node:child_process');
const learning = require('./learning.js');
const reliability = require('./reliability.js');
const mode = process.argv[1];
const ids = [];
const mark = id => ids.push(id);
const storageValues = new Map();
const storage = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, value)
};
if (mode === 'principal') {
  // README-10-03: actually run a self-contained test from npm's local suite
  // with an environment containing no account tokens or external credentials.
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'PASSWORD']) {
    assert.equal(process.env[name], undefined);
  }
  child.execFileSync(process.execPath, ['test-reliability.cjs'], {
    cwd: process.cwd(), stdio: 'pipe', timeout: 15000,
    env: { PATH: process.env.PATH || '' }
  });
  mark('README-10-03');

  // README-13-01: real, bounded measurements and adaptive safeguards.
  let state = learning.update({}, 'startup', 1200);
  state = learning.update(state, 'startup', 1800);
  state = learning.update(state, 'startup', 2500);
  state = learning.update(state, 'cycle', 3100);
  state = learning.update(state, 'recovery');
  state = learning.update(state, 'failure');
  state = learning.update(state, 'error', 0, {code:'synthetic_timeout'});
  assert.deepEqual(state.startupSamplesMs, [1200, 1800, 2500]);
  assert.deepEqual(state.responseSamplesMs, [3100]);
  assert.equal(state.cycles, 1);
  assert.equal(state.recoveries, 1);
  assert.equal(state.failures, 1);
  assert.equal(state.errorsByCode.synthetic_timeout, 1);
  assert.ok(learning.startupTimeoutMs(state) >= 15000);
  assert.ok(learning.errorBackoffMs(state, 'synthetic_timeout') >
            learning.errorBackoffMs({}, 'synthetic_timeout'));
  let runtime = reliability.normalize();
  for (let n = 0; n < reliability.MAX_FAILURES; n++) {
    runtime = reliability.afterFailure(runtime, 100000);
  }
  assert.equal(runtime.consecutiveFailures, reliability.MAX_FAILURES);
  assert.ok(runtime.circuitOpenUntil > 100000);
  assert.equal(reliability.afterSuccess(runtime).consecutiveFailures, 0);
  mark('README-13-01');

  // README-13-02: a caller's arbitrary conversation text and identifiers
  // must not become persisted learning/reliability state.
  const SENTINEL = 'SYNTHETIC_CONVERSATION_TEXT_NOT_TO_STORE';
  const memory = learning.update({chatText:SENTINEL, conversationId:SENTINEL},
                                 'cycle', 1200, {chatText:SENTINEL});
  const retained = reliability.save(storage, {
    ...reliability.normalize({pendingSignature:reliability.signature('synthetic')}),
    chatText:SENTINEL, conversationId:SENTINEL
  });
  assert.equal(memory.chatText, undefined);
  assert.equal(memory.conversationId, undefined);
  assert.equal(retained.chatText, undefined);
  assert.equal(retained.conversationId, undefined);
  assert.equal(reliability.load(storage).pendingSignature,
               reliability.signature('synthetic'));
  assert.equal(JSON.stringify({memory, retained, storage:[...storageValues.values()]})
                   .includes(SENTINEL), false);
  mark('README-13-02');
} else if (mode === 'negative') {
  assert.deepEqual(learning.normalize({
    startupSamplesMs:[null, -5, 0, 600001, '200', 750],
    responseSamplesMs:[-1, 21600001, 500]
  }).startupSamplesMs, [750]);
  assert.deepEqual(learning.normalize({responseSamplesMs:[-1,21600001,500]})
                   .responseSamplesMs, [500]);
  assert.equal(learning.startupTimeoutMs({startupSamplesMs:[]}),45000);
  assert.equal(learning.errorBackoffMs({}, 'unknown'),15000);
  assert.equal(reliability.sendAccepted({composerCleared:false,
                 messageAppeared:true,generationStarted:true}),false);
  assert.equal(reliability.sendAccepted({}),false);
  assert.equal(reliability.lateSendAccepted({circuitOpen:false,
                 generating:true,assistantCount:3,assistantCountBeforeSend:2}),false);
  storageValues.set(reliability.SESSION_KEY, '{broken');
  assert.equal(reliability.load(storage).consecutiveFailures, 0);
  assert.equal(reliability.canReload({reloadAttempts:reliability.MAX_RELOADS,
                                    reloadWindowStartedAt:10000},10001),false);
  mark('DENIED');
} else {
  throw new Error('unsupported test mode');
}
console.log(JSON.stringify({verified:ids, runtime:'local_node_only',
                            production:'UNKNOWN', network:'disabled'}));
"""


def matrix_ids(source: str) -> set[str]:
    """Check source inventory instead of claiming that every README row is green."""
    found: set[str] = set()
    for line in source.splitlines():
        if not line.startswith("| README-"):
            continue
        fields = [piece.strip() for piece in line.strip().strip("|").split("|")]
        key = fields[0].split(" · ", 1)[0]
        if len(fields) != 5 or not re.fullmatch(r"README-\d{2}-\d{2}", key):
            raise ValueError("UNKNOWN: malformed source row")
        if key in found:
            raise ValueError("UNKNOWN: duplicated source row")
        if fields[2] != "NO_VERIFICABLE":
            raise ValueError("UNKNOWN: source status changed independently")
        found.add(key)
    return found


def node_case(mode: str) -> dict:
    if mode not in ("principal", "negative"):
        raise ValueError("unsupported mode")
    executable = shutil.which("node")
    if executable is None:
        raise AssertionError("UNKNOWN: Node.js required for real code assertions")
    env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL")
           if key in os.environ}
    completed = subprocess.run(
        [executable, "-e", NODE, mode], cwd=ROOT, env=env,
        capture_output=True, text=True, timeout=35, check=False,
    )
    if completed.returncode:
        raise AssertionError("UNKNOWN: Node behavior failed: " + completed.stderr[-900:])
    try:
        return json.loads(completed.stdout.strip())
    except (ValueError, TypeError) as error:
        raise AssertionError("UNKNOWN: malformed Node evidence") from error


class CoberturaAutofactory08Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        self.assertEqual(len(EXPECTED), 20)
        self.assertTrue(EXPECTED.issubset(matrix_ids(MATRIX.read_text(encoding="utf-8"))))
        result = node_case("principal")
        self.assertEqual(set(result["verified"]), OFFLINE)
        self.assertEqual(result["production"], "UNKNOWN")
        self.assertEqual(result["network"], "disabled")
        self.assertEqual(len(EXTERNAL), 12)
        self.assertEqual(len(DECLARATIVE), 5)
        self.assertFalse(ABSENT)

    def test_falla_cerrado(self) -> None:
        result = node_case("negative")
        self.assertEqual(result["verified"], ["DENIED"])
        self.assertEqual(result["production"], "UNKNOWN")
        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
            matrix_ids("| README-13-01 · README.md | test | NO_VERIFICABLE | reason | issue |\n"
                       "| README-13-01 · README.md | test | NO_VERIFICABLE | reason | issue |")
        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
            matrix_ids("| README-13-02 | malformed |")
        with self.assertRaises(ValueError):
            node_case("unsupported")

    def test_ci_contract(self) -> None:
        """Required Validate checks out the authored HEAD and runs the local suite."""
        workflow = (ROOT / ".github/workflows/validate.yml").read_text(encoding="utf-8")
        self.assertIn("name: Validate", workflow)
        self.assertIn("name: Validate / Pruebas y smoke Chrome", workflow)
        self.assertIn("ref: $" + "{{ github.event.pull_request.head.sha || github.sha }}", workflow)
        self.assertIn("- run: npm test", workflow)
        self.assertIn("Autocontrol de wiring de aceptación", workflow)

    def test_sin_datos_reales(self) -> None:
        self.assertEqual(EXPECTED, OFFLINE | EXTERNAL.keys() | DECLARATIVE.keys())
        self.assertTrue(all(EXTERNAL.values()) and all(DECLARATIVE.values()))
        self.assertFalse(ABSENT)
        source = Path(__file__).read_text(encoding="utf-8")
        self.assertNotRegex(source, r"-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----")
        self.assertNotRegex(source, r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
        self.assertNotIn("node" + "-fetch", source)
        self.assertNotIn("https:" + "//api.", source)
        self.assertEqual(node_case("principal")["production"], "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
