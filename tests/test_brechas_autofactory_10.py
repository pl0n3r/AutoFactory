#!/usr/bin/env python3
"""AutoFactory #317: five offline session and release-evidence gaps.

All fixtures are synthetic, evaluated without credentials, browsers, network,
real provider accounts, published releases, or destructive rollback. A green
unit test does not promote the coverage matrix or operational readiness.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs" / "matriz-cobertura.md"
SESSION_DOC = ROOT / "docs" / "OFFLINE-SESSION-STATE-DENIALS.md"
RELEASE_DOC = ROOT / "docs" / "RELEASE-EVIDENCE.md"
WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"
REQUIREMENTS = (
    "DOC-OFFLINE-SESSION-STATE-DENIALS-02",
    "DOC-OFFLINE-SESSION-STATE-DENIALS-03",
    "DOC-OFFLINE-SESSION-STATE-DENIALS-04",
    "DOC-RELEASE-EVIDENCE-01",
    "DOC-RELEASE-EVIDENCE-02",
)
UNKNOWN = "UNKNOWN"

NODE_HARNESS = r"""
'use strict';
const assert = require('node:assert/strict');
const { evaluate } = require('./factory-control-session-keepalive.js');
const { classifyAccountState, classifyProviderPageSignal,
  createProviderAccountStateObserver } = require('./factory-control-account-state.js');
const { verifyReleaseEvidence, REQUIRED_CHECKS } =
  require('./scripts/verify-release-evidence.cjs');

const NOW = 10000;
const SENTINEL = 'SYNTHETIC_PRIVATE_NEVER_EXPORT';
function state() {
  return {
    chat: {
      reservation_active: true, reply_complete: true,
      last_prompt_s: 9100, last_reply_s: 9200,
      last_activity_s: 9300, last_reply_chars: 37,
      msgs_hour: 3, state: 'inactivo', identical_read_count: 2
    },
    account: { observed_limit_hour: 40, msgs_hour: 10, usage_limited: false },
    controls: {
      enabled: true, manual_pause: false, kill_switch_running: true,
      circuit_breaker_open: false, ambiguous_send: false, session_closed: false
    },
    history: { retries_s: [] }
  };
}
function deny(mutate, reason) {
  const next = state();
  mutate(next);
  const result = evaluate(next, NOW);
  return result.action === 'detener'
    && result.idle_reason === reason && result.continuation === null;
}
async function sessionEvidence() {
  const base = evaluate(state(), NOW);
  assert.equal(base.action, 'reenganchar');
  const denied = [
    [s => { s.controls.session_closed = true; }, 'sesion_cerrada'],
    [s => { s.account.usage_limited = true; }, 'limite_horario'],
    [s => { s.controls.kill_switch_running = false; }, 'pausa_manual'],
    [s => { s.chat.state = 'UNKNOWN'; }, 'desconocido'],
    [s => { s.chat.last_activity_s = NOW + 1; }, 'desconocido'],
    [s => { s.chat.identical_read_count = 1; }, 'desconocido'],
  ].every(([mutation, reason]) => deny(mutation, reason));
  const waiting = state();
  waiting.chat.reply_complete = false;
  const pending = evaluate(waiting, NOW).action === 'esperar';
  const account = classifyAccountState({
    authenticated: true, usageLimited: true,
    providerError: false, resetAt: null
  }, () => NOW);
  const provider = classifyProviderPageSignal({
    signalCode: 'rate-limit', alertText: null
  }, () => NOW);
  return {
    denial: denied && pending && account.state === 'limit'
      && provider.state === 'limit',
    unknown: deny(s => { s.account.observed_limit_hour = 0; }, 'desconocido'),
  };
}
async function observerEvidence() {
  const nowMs = 1000000;
  const observer = observedAt => createProviderAccountStateObserver({
    readProviderSignal: async () => ({
      signalCode: 'ready', alertText: null, observedAt
    }),
    now: () => nowMs, maxAgeMs: 1000,
  });
  const fresh = await observer(nowMs - 1000).read();
  const stale = await observer(nowMs - 1001).read();
  const future = await observer(nowMs + 1).read();
  const withExtras = createProviderAccountStateObserver({
    readProviderSignal: async () => ({
      signalCode: 'ready', alertText: null, observedAt: nowMs,
      conversation_id: SENTINEL
    }),
    now: () => nowMs, maxAgeMs: 1000,
  });
  const hidden = await withExtras.read();
  const snapshot = state();
  snapshot.chat.message = SENTINEL;
  snapshot.chat.conversation_id = SENTINEL;
  snapshot.controls.auth_token = SENTINEL;
  snapshot.controls.session_closed = true;
  const result = evaluate(snapshot, NOW);
  const redacted = !JSON.stringify(result).includes(SENTINEL)
    && !JSON.stringify(hidden).includes(SENTINEL);
  return fresh.state === 'ready'
    && fresh.freshness === 'fresh'
    && stale.state === 'unknown'
    && stale.freshness === 'stale'
    && future.state === 'unknown'
    && hidden.state === 'unknown'
    && result.action === 'detener'
    && result.continuation === null
    && redacted;
}
function releaseEvidence() {
  const base = {
    tag: 'v1.6.3', commit_sha: 'a'.repeat(40),
    preflight: 'success', publish: 'success',
    chrome_smoke: 'success', safari_smoke: 'success',
    rollback: 'success',
  };
  assert.deepEqual(REQUIRED_CHECKS,
    ['preflight', 'publish', 'chrome_smoke', 'safari_smoke', 'rollback']);
  const historical = ['v1.6.3', 'v1.6.4'].every(tag => {
    const known = { ...base, tag, preflight: 'failure', publish: 'skipped' };
    return verifyReleaseEvidence(known).verified === false;
  });
  const recovered = { ...base, tag: 'v9.9.9' };
  delete recovered.chrome_smoke;
  delete recovered.safari_smoke;
  delete recovered.rollback;
  const recoveryDenial = verifyReleaseEvidence(recovered).verified === false;
  const allSyntheticChecks = verifyReleaseEvidence(base).verified === true;
  const unknownDenial = REQUIRED_CHECKS.every(field => {
    const missing = { ...base };
    delete missing[field];
    const ambiguous = { ...base, [field]: 'UNKNOWN' };
    return !verifyReleaseEvidence(missing).verified
      && !verifyReleaseEvidence(ambiguous).verified;
  });
  return { historical, recoveryDenial, unknownDenial, allSyntheticChecks };
}
(async () => {
  const session = await sessionEvidence();
  const observation = await observerEvidence();
  const release = releaseEvidence();
  console.log(JSON.stringify({
    'DOC-OFFLINE-SESSION-STATE-DENIALS-02': session.denial,
    'DOC-OFFLINE-SESSION-STATE-DENIALS-03': observation,
    'DOC-OFFLINE-SESSION-STATE-DENIALS-04': session.unknown
      && observation,
    'DOC-RELEASE-EVIDENCE-01': release.historical
      && release.unknownDenial,
    'DOC-RELEASE-EVIDENCE-02': release.recoveryDenial
      && release.allSyntheticChecks,
  }));
})().catch(error => {
  console.error(error?.name || 'Synthetic contract failure');
  process.exitCode = 1;
});
"""


def evidence_state(value: object) -> str:
    """Only an actual boolean success from the isolated harness is a test result."""
    return "TEST_EXECUTED" if value is True else UNKNOWN


def matrix_status(source: str, requirement: str) -> str:
    matches = [
        line for line in source.splitlines()
        if line.startswith("| " + requirement + " ·")
    ]
    if len(matches) != 1:
        return UNKNOWN
    cells = [piece.strip() for piece in matches[0].strip("|").split("|")]
    return cells[2] if len(cells) >= 5 and cells[2] in {
        "NO_VERIFICABLE", "CUBIERTO", "UNKNOWN",
    } else UNKNOWN


def run_synthetic_harness() -> dict[str, object]:
    # Explicitly discard all inherited secrets, cookies and network proxies.
    safe_env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C",
    }
    result = subprocess.run(
        ["node", "-e", NODE_HARNESS],
        cwd=ROOT, env=safe_env, text=True, capture_output=True,
        check=False, timeout=40,
    )
    if result.returncode != 0:
        raise AssertionError(
            "Synthetic Node contract failed (no private payload logged): "
            + result.stderr[-500:]
        )
    return json.loads(result.stdout)


class BrechasAutofactory10Tests(unittest.TestCase):
    def test_contrato_principal(self):
        """AC-01: all five IDs execute their own real offline contracts."""
        outputs = run_synthetic_harness()
        self.assertEqual(set(REQUIREMENTS), set(outputs))
        for requirement in REQUIREMENTS:
            with self.subTest(requirement=requirement):
                self.assertEqual("TEST_EXECUTED", evidence_state(outputs[requirement]))

        session = SESSION_DOC.read_text(encoding="utf-8")
        release = RELEASE_DOC.read_text(encoding="utf-8")
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Gates pendientes y reversión", session)
        self.assertIn("npm test", session)
        self.assertIn("v1.6.3", release)
        self.assertIn("v1.6.4", release)
        self.assertIn("preflight=failure", release)
        self.assertIn("preflight=success", release)
        self.assertIn("publish=success", release)
        self.assertIn("rollback=success", release)
        self.assertIn("needs: [preflight, chrome_smoke, safari_smoke]", workflow)
        self.assertIn("node scripts/chrome-ephemeral-smoke.cjs", workflow)
        self.assertIn("bash scripts/safari-unsigned-build-smoke.sh", workflow)

    def test_falla_cerrado(self):
        """AC-02: empty, ambiguous and non-executed results cannot be green."""
        for requirement in REQUIREMENTS:
            with self.subTest(requirement=requirement):
                for invalid in (None, False, {}, [], "ready", "success", 1):
                    self.assertEqual(UNKNOWN, evidence_state(invalid))
                self.assertEqual(UNKNOWN, matrix_status("", requirement))
        self.assertEqual(UNKNOWN, matrix_status(
            "| DOC-RELEASE-EVIDENCE-01 · docs | title | NO_VERIFICABLE | reason | - |\n"
            "| DOC-RELEASE-EVIDENCE-01 · docs | title | CUBIERTO | reason | - |",
            "DOC-RELEASE-EVIDENCE-01",
        ))
        outputs = run_synthetic_harness()
        self.assertTrue(all(value is True for value in outputs.values()))
        self.assertFalse(evidence_state(None) == "TEST_EXECUTED")

    def test_sin_datos_reales(self):
        """AC-03: no provider credentials, personal data, real sessions or fetch."""
        self.assertNotIn("https://", NODE_HARNESS)
        self.assertNotIn("fetch(", NODE_HARNESS)
        self.assertNotIn("XMLHttpRequest", NODE_HARNESS)
        self.assertNotIn("gh api", NODE_HARNESS)
        self.assertNotIn("process.env", NODE_HARNESS)
        self.assertNotIn("sessionStorage", NODE_HARNESS)
        self.assertIn("SYNTHETIC_PRIVATE_NEVER_EXPORT", NODE_HARNESS)
        self.assertIn("env=safe_env", Path(__file__).read_text(encoding="utf-8"))
        self.assertEqual(set(run_synthetic_harness()), set(REQUIREMENTS))

    def test_estados_unknown_explicitos(self):
        """AC-04: coverage matrix and live session/release evidence stay UNKNOWN."""
        matrix = MATRIX.read_text(encoding="utf-8")
        self.assertEqual(len(REQUIREMENTS), len(set(REQUIREMENTS)))
        for requirement in REQUIREMENTS:
            with self.subTest(requirement=requirement):
                self.assertEqual("NO_VERIFICABLE", matrix_status(matrix, requirement))
                self.assertEqual(UNKNOWN, evidence_state(None))
        session = SESSION_DOC.read_text(encoding="utf-8")
        release = RELEASE_DOC.read_text(encoding="utf-8")
        self.assertIn("no acredita", session)
        self.assertIn("not sufficient evidence", release)
        self.assertIn("not by themselves satisfy", release)
        self.assertIn("ControlBot#20", release)


if __name__ == "__main__":
    unittest.main()
