#!/usr/bin/env python3
"""#393: real offline acceptance checks; no browser, ControlBot or release claims.

A denotes a tested local sub-contract only. B rows need genuine external
evidence and C rows document a non-executable procedure. Neither an A result
nor a green local run promotes any matrix row to CUBIERTO.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
UNKNOWN = "UNKNOWN"

# The test invokes real committed Node modules, not copied Python models.
OFFLINE = {
    "DOC-EXTENSION-SOURCE-PREFLIGHT-01":
        "Verify real extension asset parity and deny permission expansion.",
    "DOC-OFFLINE-SESSION-STATE-DENIALS-01":
        "Exercise real keepalive denial when the session is closed.",
    "DOC-OFFLINE-SESSION-STATE-DENIALS-02":
        "Exercise real account-state freshness and invalid-signal rejection.",
    "DOC-RELEASE-EVIDENCE-03":
        "Exercise the release-evidence verifier with synthetic gate outcomes.",
    "DOC-RELEASE-SECURITY-01":
        "Exercise the real release verifier's missing/invalid evidence denial.",
    "DOC-SESSION-KEEPALIVE-01":
        "Exercise the real recommendation/wait state machine with a fake clock.",
    "DOC-SESSION-KEEPALIVE-02":
        "Exercise budget, two reads and pacing checks in the real policy.",
    "DOC-SESSION-KEEPALIVE-03":
        "Exercise allowlisted diagnostic projection without input identifiers.",
    "DOC-SESSION-KEEPALIVE-04":
        "Exercise the pure policy with a clock injection and no side effects.",
}
# B means the requirement cannot be established by these synthetic probes.
NON_OFFLINE = {
    "DOC-OBSERVADOR-RESERVAS-V3-01": ("B",
        "24-hour / 100-cycle authentic GitHub observer history is required."),
    "DOC-OBSERVADOR-RESERVAS-V3-02": ("B",
        "Operational success and terminal leases need signed GitHub evidence."),
    "DOC-OBSERVADOR-RESERVAS-V3-03": ("B",
        "Observer recovery and absence of auto-release require real runs."),
    "DOC-OFFLINE-SESSION-STATE-DENIALS-03": ("C",
        "How-to-run commands are a documented procedure, not a runtime function."),
    "DOC-OFFLINE-SESSION-STATE-DENIALS-04": ("B",
        "Browser safety, approval and rollback require real integration."),
    "DOC-RELEASE-EVIDENCE-01": ("B",
        "Historical provenance needs authentic signed release/runner receipts."),
    "DOC-RELEASE-EVIDENCE-02": ("B",
        "Recovery of release runners needs authentic completed job evidence."),
    "DOC-SONAR-CHECK-DETAILS-01": ("B",
        "Sonar relay execution needs authentic GitHub check/PR events."),
    "ISSUE-1": ("B",
        "End-to-end remote Factory Control needs legal consent and live smoke."),
    "ISSUE-122": ("B",
        "A real Xcode Safari bundle and GUI load cannot run in a fake clock."),
    "ISSUE-129": ("B",
        "Real pairing needs legal approval and authenticated ControlBot traffic."),
}
IDS = frozenset(OFFLINE) | frozenset(NON_OFFLINE)

NODE = r"""
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateExtensionTree } = require('./scripts/verify-extension-assets.cjs');
const { verifyReleaseEvidence } = require('./scripts/verify-release-evidence.cjs');
const { evaluate, createPolicy } = require('./factory-control-session-keepalive.js');
const { classifyAccountState, createProviderAccountStateObserver } =
    require('./factory-control-account-state.js');

const NOW = 10000;
const snapshot = () => ({
  chat: { reservation_active: true, reply_complete: true,
    last_prompt_s: 9100, last_reply_s: 9200, last_activity_s: 9300,
    last_reply_chars: 37, msgs_hour: 3, state: 'inactivo',
    identical_read_count: 2 },
  account: { observed_limit_hour: 40, msgs_hour: 10, usage_limited: false },
  controls: { enabled: true, manual_pause: false, kill_switch_running: true,
    circuit_breaker_open: false, ambiguous_send: false, session_closed: false },
  history: { retries_s: [] }
});
const changed = mutate => {
  const input = snapshot();
  mutate(input);
  return evaluate(input, NOW);
};
async function check() {
  const passed = [];
  const denied = [];

  const validTree = validateExtensionTree(process.cwd());
  assert.match(validTree.version, /^\d+\.\d+\.\d+$/);
  assert.ok(validTree.assets >= 9);
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const altered = {
    lstatSync: fs.lstatSync,
    readFileSync(file) {
      if (path.resolve(file) === path.resolve('manifest.json')) {
        return Buffer.from(JSON.stringify({
          ...manifest, permissions: [...manifest.permissions, 'webRequest']
        }));
      }
      return fs.readFileSync(file);
    }
  };
  assert.throws(
    () => validateExtensionTree(process.cwd(), altered),
    /unexpected permission or host/
  );
  passed.push('DOC-EXTENSION-SOURCE-PREFLIGHT-01');
  denied.push('extension-expanded-permission');

  assert.equal(changed(s => s.controls.session_closed = true).idle_reason,
    'sesion_cerrada');
  assert.equal(changed(s => s.account.usage_limited = true).idle_reason,
    'limite_horario');
  assert.equal(changed(s => s.controls.kill_switch_running = false).action,
    'detener');
  passed.push('DOC-OFFLINE-SESSION-STATE-DENIALS-01');
  denied.push('closed-session', 'limited-account', 'paused-switch');

  const ready = { authenticated: true, usageLimited: false,
    providerError: false, resetAt: null };
  assert.equal(classifyAccountState(ready, () => NOW).state, 'ready');
  assert.equal(classifyAccountState({
    ...ready, unexpectedField: true
  }, () => NOW).state, 'unknown');
  const obs = createProviderAccountStateObserver({
    readProviderSignal: async () => ({
      signalCode: 'ready', alertText: null, observedAt: 1000000 - 1001
    }),
    now: () => 1000000, maxAgeMs: 1000
  });
  const stale = await obs.read();
  assert.equal(stale.state, 'unknown');
  assert.equal(stale.freshness, 'stale');
  passed.push('DOC-OFFLINE-SESSION-STATE-DENIALS-02');
  denied.push('unknown-account-fields', 'stale-observation');

  const gates = { tag: 'v1.2.3', commit_sha: 'a'.repeat(40),
    preflight: 'success', publish: 'success', chrome_smoke: 'success',
    safari_smoke: 'success', rollback: 'success' };
  assert.equal(verifyReleaseEvidence(gates).verified, true);
  assert.equal(verifyReleaseEvidence({
    ...gates, safari_smoke: 'skipped'
  }).verified, false);
  passed.push('DOC-RELEASE-EVIDENCE-03');
  denied.push('safari-smoke-skipped');
  assert.equal(verifyReleaseEvidence({
    ...gates, rollback: undefined
  }).verified, false);
  assert.equal(verifyReleaseEvidence({
    ...gates, commit_sha: 'invalid'
  }).verified, false);
  assert.equal(verifyReleaseEvidence({
    ...gates, privileged: true
  }).verified, false);
  passed.push('DOC-RELEASE-SECURITY-01');
  denied.push('rollback-unknown', 'invalid-sha', 'unexpected-evidence');

  assert.equal(evaluate(snapshot(), NOW).action, 'reenganchar');
  assert.equal(changed(s => s.chat.reply_complete = false).action, 'esperar');
  passed.push('DOC-SESSION-KEEPALIVE-01');
  denied.push('await-reply');
  assert.equal(changed(s => s.account.observed_limit_hour = null).idle_reason,
    'desconocido');
  assert.equal(changed(s => s.chat.identical_read_count = 1).action, 'detener');
  assert.equal(changed(s => s.controls.min_pacing_s = 59).action, 'detener');
  passed.push('DOC-SESSION-KEEPALIVE-02');
  denied.push('unknown-quota', 'single-observation', 'invalid-pacing');

  const privateInput = snapshot();
  privateInput.chat.private_chat_content = 'SYNTHETIC_PRIVATE_NOT_OUTPUT';
  privateInput.account.private_identity = 'SYNTHETIC_PERSON_NOT_OUTPUT';
  const privateResult = evaluate(privateInput, NOW);
  assert.equal(privateResult.action, 'reenganchar');
  assert.equal(JSON.stringify(privateResult).includes('SYNTHETIC_PRIVATE'), false);
  assert.deepEqual(Object.keys(privateResult), [
    'action', 'idle_reason', 'idle_since', 'next_allowed_s',
    'last_prompt_s', 'last_reply_s', 'last_reply_chars',
    'msgs_hour', 'state', 'continuation'
  ]);
  passed.push('DOC-SESSION-KEEPALIVE-03');
  denied.push('private-payload-excluded');

  const policy = createPolicy({ now: () => NOW });
  assert.deepEqual(policy.decide(snapshot()), evaluate(snapshot(), NOW));
  assert.equal(createPolicy({now: () => null}).decide(snapshot()).action,
    'detener');
  passed.push('DOC-SESSION-KEEPALIVE-04');
  denied.push('clock-unknown');

  process.stdout.write(JSON.stringify({
    passed, denied, operational_state: 'UNKNOWN'
  }));
}
check().catch(() => {
  // A probe failure never emits private inputs, environment or raw exceptions.
  process.stderr.write('AutoFactory real offline acceptance probe failed\n');
  process.exitCode = 1;
});
"""


def rows_from_matrix(document: object) -> dict[str, tuple[str, ...]]:
    """Fail closed on missing, duplicated, promoted or contradictory rows."""
    if not isinstance(document, str):
        raise ValueError("UNKNOWN: matrix unreadable")
    found: dict[str, tuple[str, ...]] = {}
    for line in document.splitlines():
        if not line.startswith("| "):
            continue
        cells = tuple(cell.strip() for cell in line.strip().strip("|").split("|"))
        head = cells[0].split(" · ", 1) if cells else []
        if not head or head[0] not in IDS:
            continue
        key = head[0]
        if (key in found or len(head) != 2 or len(cells) != 5
                or not all(cells) or cells[2] != "NO_VERIFICABLE"):
            raise ValueError("UNKNOWN: contradictory matrix row " + key)
        found[key] = cells
    if set(found) != IDS:
        raise ValueError("UNKNOWN: missing expected matrix rows")
    return found


def run_real_contract() -> dict[str, object]:
    node = shutil.which("node")
    if not node:
        raise AssertionError("Node >= 20 is required for real JS acceptance")
    process = subprocess.run(
        [node, "-e", NODE], cwd=ROOT, capture_output=True, text=True,
        check=False, timeout=35, env={
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "LC_ALL": "C",
        }
    )
    if process.returncode != 0:
        raise AssertionError("Real offline JS acceptance probe failed")
    result = json.loads(process.stdout)
    if not isinstance(result, dict):
        raise AssertionError("UNKNOWN: invalid JS evidence")
    return result


class CoberturaAutofactory03Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.matrix = MATRIX.read_text(encoding="utf-8")
        cls.rows = rows_from_matrix(cls.matrix)
        cls.probe = run_real_contract()

    def test_contrato_principal(self) -> None:
        """AC-01: each A calls genuine JS; B/C remain out of offline scope."""
        self.assertEqual(len(IDS), 20)
        self.assertEqual(len(OFFLINE), 9)
        self.assertEqual(set(self.rows), IDS)
        self.assertEqual(set(self.probe["passed"]), set(OFFLINE))
        for key, row in self.rows.items():
            with self.subTest(row=key):
                self.assertTrue(row[0].startswith(key + " · "))
                self.assertEqual(row[2], "NO_VERIFICABLE")
                self.assertIn("#", row[4])
        for kind, why in NON_OFFLINE.values():
            self.assertIn(kind, ("B", "C", "D"))
            self.assertTrue(why)
        self.assertEqual(self.probe["operational_state"], UNKNOWN)

    def test_falla_cerrado(self) -> None:
        """AC-02: ambiguity, unknown access and bad permission fail shut."""
        sample = next(line for line in self.matrix.splitlines()
                      if line.startswith("| DOC-SESSION-KEEPALIVE-01 · "))
        for corrupted in (
            self.matrix.replace(sample + "\n", "", 1),
            self.matrix + "\n" + sample,
            self.matrix.replace(sample, sample.replace("NO_VERIFICABLE", "CUBIERTO"), 1),
            self.matrix.replace(sample, "| DOC-SESSION-KEEPALIVE-01 · broken |"),
        ):
            with self.subTest(corrupted_len=len(corrupted)):
                with self.assertRaisesRegex(ValueError, UNKNOWN):
                    rows_from_matrix(corrupted)
        with self.assertRaisesRegex(ValueError, UNKNOWN):
            rows_from_matrix(None)
        self.assertEqual(set(self.probe["denied"]), {
            "extension-expanded-permission", "closed-session",
            "limited-account", "paused-switch", "unknown-account-fields",
            "stale-observation", "safari-smoke-skipped", "rollback-unknown",
            "invalid-sha", "unexpected-evidence", "await-reply",
            "unknown-quota", "single-observation", "invalid-pacing",
            "private-payload-excluded", "clock-unknown"
        })
        self.assertEqual(self.probe["operational_state"], UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        """AC-03: no network, credentials, conversation content or live I/O."""
        self.assertTrue(MATRIX.is_file())
        self.assertEqual(set(self.probe), {
            "passed", "denied", "operational_state"
        })
        self.assertEqual(self.probe["operational_state"], UNKNOWN)
        self.assertNotRegex(NODE, r"require\(['\"](?:https?|socket|net|tls|child_process)")
        self.assertNotRegex(NODE, r"\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(")
        evidence = json.dumps(self.probe, ensure_ascii=False)
        for forbidden in (
            "SYNTHETIC_PRIVATE", "SYNTHETIC_PERSON", "ghp_", "sk-",
            "Bearer ", "chatgpt.com/", "profileAlias", "accountAlias"
        ):
            self.assertNotIn(forbidden, evidence)


if __name__ == "__main__":
    unittest.main()
