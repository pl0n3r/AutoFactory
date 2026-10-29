#!/usr/bin/env python3
"""AutoFactory #392: execute real offline contracts; never infer production GREEN.

Classifications for the twenty matrix rows are explicit. A means a real
JavaScript function is exercised with synthetic inputs. B requires authentic
external/browser evidence; C describes policy rather than an executable
function; D lacks the described log implementation. These are not claims
that the coverage matrix or production readiness have been reconciled.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Non-A rows must never be reported as covered by the synthetic suite.
NON_OFFLINE = {
    "AGENTES-01-17": ("C", "Privacy-data inventory update is a PR/legal policy, not a callable function."),
    "AGENTES-01-20": ("B", "Browser installation and production GREEN require real Chrome/Safari smoke."),
    "AGENTES-01-22": ("D", "local-tab-progress.js classifies state but provides no 200-event log."),
    "AGENTES-02-01": ("B", "Cross-PR path reservations require authenticated GitHub coordination."),
    "AGENTES-02-02": ("C", "Commit/review limits are workflow policy, not extension behavior."),
    "AGENTES-02-03": ("C", "Recording GitHub evidence is an agent practice, not a local runtime API."),
    "DEC-D-054": ("C", "Database migration policy applies to database products, not this extension."),
    "DEC-D-055": ("C", "Production-write policy does not enable extension remote runtime."),
    "DEC-D-057": ("B", "Issue/PR label enforcement is performed by GitHub coordination."),
    "DEC-D-058": ("B", "Role assertions and owner duties require authentic issue/PR governance."),
    "DEC-D-059": ("C", "Hostinger infrastructure rules do not implement an AutoFactory action."),
    "DOC-CI-EXTENSION-SECURITY-01": ("B", "Workflow contract tests do not prove external runner/device security."),
}

OFFLINE = (
    "AGENTES-01-16", "AGENTES-01-18", "AGENTES-01-19", "AGENTES-01-21",
    "DEC-D-056", "DEC-D-060", "DEC-D-061", "DEC-D-062",
)

NODE = r"""
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const protocol = require('./factory-control-protocol.js');
const pairing = require('./factory-control-pairing.js');
const authorization = require('./factory-control-authorization.js');
const progress = require('./local-tab-progress.js');
const { verifyReleaseEvidence } = require('./scripts/verify-release-evidence.cjs');
const { buildReleaseAttestation, EXPECTED_RUNTIME_ASSETS } =
  require('./scripts/release-artifact-attestation.cjs');

async function check() {
  const passed = [];
  const negative = [];
  const hb = { profileAlias: 'profile_01', accountAlias: 'account_01',
    tabs: [], accountState: { state: 'ready', resetAt: null },
    lastEvent: 'progress' };
  const safe = protocol.heartbeat(hb);
  assert.equal(safe.kind, 'heartbeat');
  assert.deepEqual(safe.tabs, []);
  assert.equal(Object.hasOwn(safe, 'conversationText'), false);
  assert.throws(() => protocol.heartbeat({ ...hb, conversationText: 'synthetic' }), TypeError);
  assert.throws(() => protocol.heartbeat({ ...hb, profileAlias: 'mail@invalid' }), TypeError);
  passed.push('AGENTES-01-16');
  negative.push('heartbeat-extra-field', 'heartbeat-invalid-alias');

  let remoteReads = 0;
  let credentialsIssued = 0;
  const pair = pairing.createPairingContract({
    loadVerifiedChallenge: async () => {
      remoteReads += 1;
      return { challengeId: 'challenge_01', profileAlias: 'profile_01',
        expiresAt: 990, revoked: false, used: false };
    },
    consumeVerifiedChallenge: async () => { throw Error('not invoked'); },
    issueOpaqueCredential: async () => { credentialsIssued += 1; throw Error('not invoked'); },
    revokeOpaqueCredential: async () => false,
    now: () => 1000
  });
  assert.deepEqual(await pair.pair({ profileAlias: 'profile_01', code: 'invalid' }),
    { ok: false, code: 'invalid' });
  assert.equal(remoteReads, 0);
  assert.deepEqual(await pair.pair({ profileAlias: 'profile_01', code: '123456' }),
    { ok: false, code: 'expired' });
  assert.equal(credentialsIssued, 0);
  passed.push('AGENTES-01-18', 'DEC-D-061');
  negative.push('pairing-invalid-code', 'pairing-expired-challenge');

  const authorizer = authorization.createCommandAuthorizer({
    loadVerifiedGrant: async () => ({ profileAlias: 'profile_01',
      expiresAt: 2000, revoked: false, actions: ['pause'], tabIds: [7],
      broadcast: false }),
    now: () => 1000
  });
  const context = { profileAlias: 'profile_01', enabledTabIds: [7] };
  const permitted = await authorizer.authorize(
    { id: 'command_01', action: 'pause', target: 7 }, context);
  assert.equal(permitted.action, 'pause');
  await assert.rejects(
    authorizer.authorize({ id: 'command_02', action: 'send_message',
      target: 7, payload: { text: 'synthetic' } }, context),
    /not authorized/);
  await assert.rejects(
    authorizer.authorize({ id: 'command_03', action: 'pause', target: 8 }, context),
    /not authorized/);
  await assert.rejects(
    authorizer.authorize({ id: 'command_04', action: 'pause', target: 'all' }, context),
    /not authorized/);
  passed.push('AGENTES-01-19');
  negative.push('command-ungranted-action', 'command-disabled-tab', 'command-broadcast');

  const tab = { nowMs: 100000, lastActivityAtMs: 10000,
    fingerprintStableSinceMs: 20000, thresholdMs: 60000,
    previousFingerprint: 'a'.repeat(64), fingerprint: 'a'.repeat(64),
    activityObserved: false };
  assert.equal(progress.classifyTabProgress(tab), progress.STATES.NO_PROGRESS);
  assert.equal(progress.classifyTabProgress({ ...tab, lastActivityAtMs: 99999 }),
    progress.STATES.ACTIVE);
  assert.equal(progress.classifyTabProgress({ ...tab, fingerprint: 'bad' }),
    progress.STATES.UNKNOWN);
  let untrustedReads = 0;
  const injected = { ...tab };
  Object.defineProperty(injected, 'chatText', {
    get() { untrustedReads += 1; throw Error('forbidden read'); }
  });
  assert.equal(progress.classifyTabProgress(injected), progress.STATES.NO_PROGRESS);
  assert.equal(untrustedReads, 0);
  passed.push('AGENTES-01-21');
  negative.push('progress-invalid-digest', 'progress-chat-accessor');

  const syntheticEvidence = { tag: 'v1.2.3', commit_sha: 'a'.repeat(40),
    preflight: 'success', publish: 'success', chrome_smoke: 'success',
    safari_smoke: 'success', rollback: 'success' };
  assert.equal(verifyReleaseEvidence(syntheticEvidence).verified, true);
  for (const gate of ['preflight', 'publish', 'chrome_smoke', 'safari_smoke', 'rollback']) {
    const incomplete = { ...syntheticEvidence };
    delete incomplete[gate];
    assert.equal(verifyReleaseEvidence(incomplete).verified, false);
  }
  assert.equal(verifyReleaseEvidence({ ...syntheticEvidence, extra: true }).verified, false);
  passed.push('DEC-D-060');
  negative.push('release-missing-real-gate', 'release-unexpected-evidence');

  const version = JSON.parse(fs.readFileSync('manifest.json', 'utf8')).version;
  const attestation = buildReleaseAttestation(
    process.cwd(), 'v' + version, 'a'.repeat(40));
  assert.equal(attestation.release_version, version);
  assert.deepEqual(
    attestation.assets.map(asset => asset.path), EXPECTED_RUNTIME_ASSETS);
  assert.ok(attestation.assets.length > 0);
  for (const asset of attestation.assets) {
    assert.equal(asset.chrome_sha256, asset.safari_sha256);
    assert.match(asset.chrome_sha256, /^[0-9a-f]{64}$/);
  }
  assert.throws(() =>
    buildReleaseAttestation(process.cwd(), 'v' + version, 'bad-sha'), TypeError);
  passed.push('DEC-D-056', 'DEC-D-062');
  negative.push('artifact-invalid-sha');

  process.stdout.write(JSON.stringify({ passed, negative, production: 'UNKNOWN' }));
}
check().catch(error => {
  // Do not print adapters, aliases, credentials, chat payloads or raw errors.
  process.stderr.write('AutoFactory offline behavior assertion failed\n');
  process.exitCode = 1;
});
"""


class CoberturaAutofactory02Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", "-e", NODE],
            cwd=ROOT, capture_output=True, text=True, check=False, timeout=45,
        )
        if result.returncode != 0:
            raise AssertionError("Falló la prueba de contratos reales offline")
        cls.evidence = json.loads(result.stdout)

    def test_contrato_principal(self) -> None:
        ids = set(OFFLINE) | set(NON_OFFLINE)
        self.assertEqual(len(ids), 20)
        self.assertEqual(len(OFFLINE), 8)
        self.assertEqual(set(self.evidence["passed"]), set(OFFLINE))
        self.assertTrue(all(kind in ("B", "C", "D") and reason
                            for kind, reason in NON_OFFLINE.values()))
        self.assertEqual(self.evidence["production"], "UNKNOWN")

    def test_falla_cerrado(self) -> None:
        expected = {
            "heartbeat-extra-field", "heartbeat-invalid-alias",
            "pairing-invalid-code", "pairing-expired-challenge",
            "command-ungranted-action", "command-disabled-tab",
            "command-broadcast", "progress-invalid-digest",
            "progress-chat-accessor", "release-missing-real-gate",
            "release-unexpected-evidence", "artifact-invalid-sha",
        }
        self.assertEqual(set(self.evidence["negative"]), expected)
        self.assertEqual(self.evidence["production"], "UNKNOWN")

    def test_sin_datos_reales(self) -> None:
        self.assertEqual(
            set(self.evidence), {"passed", "negative", "production"})
        self.assertTrue(all(isinstance(row, str) for row in self.evidence["passed"]))
        serialized = json.dumps(self.evidence, ensure_ascii=False)
        for forbidden in ("@", "https://", "Bearer ", "ghp_", "sk-", "chatText",
                          "profile_01", "123456"):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
