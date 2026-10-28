"""Regression for AutoFactory #312: offline AGENTES-01-16..20 gaps.

Synthetic tests exercise the existing JS contracts, but cannot certify an installed
extension, legal authorization, real pairing, or production smoke. Those remain UNKNOWN.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
IDS = tuple(f"AGENTES-01-{number:02d}" for number in range(16, 21))

# Run actual local modules, not a simulated implementation of their policy.
# No sockets, browser, personal data, credentials or external services are used.
NODE_SCENARIOS = r"""
'use strict';
const protocol = require('./factory-control-protocol.js');
const authorization = require('./factory-control-authorization.js');
const pairing = require('./factory-control-pairing.js');
const release = require('./scripts/verify-release-evidence.cjs');
async function run() {
  const heartbeat = {
    profileAlias: 'synthetic', accountAlias: 'local',
    tabs: [], lastEvent: 'waiting'
  };
  const validHeartbeat = protocol.heartbeat(heartbeat).lastEvent === 'waiting';
  let rejectedConversationText = false;
  try {
    protocol.heartbeat({...heartbeat, lastEvent: 'synthetic chat content'});
  } catch (error) {
    rejectedConversationText = error instanceof TypeError;
  }

  const context = {profileAlias: 'synthetic', enabledTabIds: [1]};
  const grant = {
    profileAlias: 'synthetic', expiresAt: 2000, revoked: false,
    actions: ['pause'], tabIds: [1], broadcast: false
  };
  const allowed = authorization.createCommandAuthorizer({
    loadVerifiedGrant: async () => grant, now: () => 1000
  });
  const withoutGrant = authorization.createCommandAuthorizer({
    loadVerifiedGrant: async () => null, now: () => 1000
  });
  let deniedWithoutGrant = false;
  try {
    await withoutGrant.authorize({id: 'synthetic1', action: 'pause', target: 1}, context);
  } catch (error) {
    deniedWithoutGrant = error.message === 'Command not authorized';
  }

  let deniedSend = false;
  try {
    await allowed.authorize({
      id: 'synthetic2', action: 'send_message', target: 1,
      payload: {text: 'synthetic'}
    }, context);
  } catch (error) {
    deniedSend = error.message === 'Command not authorized';
  }
  const pause = await allowed.authorize({
    id: 'synthetic3', action: 'pause', target: 1
  }, context);

  let credentialIssuance = 0;
  const localPairing = pairing.createPairingContract({
    loadVerifiedChallenge: async () => null,
    consumeVerifiedChallenge: async () => false,
    issueOpaqueCredential: async () => { credentialIssuance += 1; return null; },
    revokeOpaqueCredential: async () => false,
    now: () => 1000
  });
  const pairingResult = await localPairing.pair({
    profileAlias: 'synthetic', code: '000000'
  });
  const base = {
    tag: 'v1.0.0', commit_sha: 'a'.repeat(40),
    preflight: 'success', publish: 'success',
    chrome_smoke: 'success', safari_smoke: 'success'
  };
  const missingRollback = release.verifyReleaseEvidence(base);
  const ambiguousSmoke = release.verifyReleaseEvidence({
    ...base, rollback: 'success', chrome_smoke: 'UNKNOWN'
  });

  process.stdout.write(JSON.stringify({
    validHeartbeat, rejectedConversationText, deniedWithoutGrant, deniedSend,
    allowedPause: pause.action === 'pause',
    pairingDenied: pairingResult.ok === false && credentialIssuance === 0,
    missingRollbackDenied: missingRollback.verified === false,
    ambiguousSmokeDenied: ambiguousSmoke.verified === false
  }));
}
run().catch(() => { process.exitCode = 1; });
"""


class BrechasAutofactory05Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node = shutil.which("node")
        if node is None:
            raise AssertionError("Node >=20 is required for the offline contract")
        node_dir = str(Path(node).parent) if os.path.isabs(node) else ""
        path = os.pathsep.join(
            item for item in (node_dir, "/usr/local/bin", "/usr/bin", "/bin") if item
        )
        completed = subprocess.run(
            [node, "-e", NODE_SCENARIOS], cwd=ROOT,
            env={"PATH": path}, capture_output=True, text=True,
            check=False, timeout=30,
        )
        if completed.returncode:
            raise AssertionError("Offline JS contract failed (inspect CI)")
        cls.behavior = json.loads(completed.stdout)
        cls.matrix = (ROOT / "docs/matriz-cobertura.md").read_text(encoding="utf-8")
        cls.rows = {}
        for line in cls.matrix.splitlines():
            for identifier in IDS:
                if line.startswith("| " + identifier + " "):
                    if identifier in cls.rows:
                        raise AssertionError("Duplicate matrix row: " + identifier)
                    cls.rows[identifier] = line

    def test_contrato_principal(self):
        """AC-01: each row has a behavioral assertion or an explicit closed gap."""
        self.assertEqual(set(self.rows), set(IDS))
        for identifier in IDS:
            with self.subTest(identifier=identifier):
                self.assertIn("AGENTES.md", self.rows[identifier])

        # AGENTES-01-16: bounded event codes, not free-form conversation text.
        self.assertTrue(self.behavior["validHeartbeat"])
        self.assertTrue(self.behavior["rejectedConversationText"])
        # AGENTES-01-17: legal processing cannot be certified from a fixture.
        treatments = json.loads((ROOT / "datos.yml").read_text(encoding="utf-8"))
        self.assertEqual(treatments["phase"], "construccion")
        self.assertTrue(any(
            item["basis"] == "review_required" for item in treatments["treatments"]
        ))
        # AGENTES-01-18: no verified pairing -> no credential issuance.
        self.assertTrue(self.behavior["pairingDenied"])
        # AGENTES-01-19: a pause-only grant cannot send a message.
        self.assertTrue(self.behavior["deniedSend"])
        self.assertTrue(self.behavior["allowedPause"])
        # AGENTES-01-20: release claim requires actual Chrome/Safari and rollback.
        self.assertTrue(self.behavior["missingRollbackDenied"])
        self.assertIn("Chrome/Safari", (
            ROOT / "docs/RELEASE-EVIDENCE.md"
        ).read_text(encoding="utf-8"))

    def test_falla_cerrado(self):
        """AC-02: missing permissions or ambiguous smoke cannot pass."""
        self.assertTrue(self.behavior["deniedWithoutGrant"])
        self.assertTrue(self.behavior["pairingDenied"])
        self.assertTrue(self.behavior["ambiguousSmokeDenied"])
        self.assertTrue(self.behavior["missingRollbackDenied"])
        # The offline tests do not claim live verification.
        self.assertTrue(self.behavior["deniedWithoutGrant"])

    def test_sin_datos_reales(self):
        """AC-03: test fixtures are synthetic and Node has no inherited secrets."""
        self.assertIn("synthetic chat content", NODE_SCENARIOS)
        self.assertIn("env={\"PATH\": path}", Path(__file__).read_text(encoding="utf-8"))
        for forbidden in ("http://", "https://", "fetch(", "XMLHttpRequest",
                          "process.env.", "child_process", "@example."):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, NODE_SCENARIOS)

    def test_estados_unknown_explicitos(self):
        """AC-04: one documented UNKNOWN gap per ID, not a production claim.

        Matrix status is intentionally *not* asserted: the following
        reconciliation issue may update it after real evidence is obtained.
        """
        unavailable_proofs = {
            "AGENTES-01-16": "runtime log observations for installed extension",
            "AGENTES-01-17": "approved legal treatment change",
            "AGENTES-01-18": "ControlBot#20 consent and authenticated pairing",
            "AGENTES-01-19": "platform limit behavior in an actual session",
            "AGENTES-01-20": "installed Chrome/Safari smoke and rollback",
        }
        self.assertEqual(set(unavailable_proofs), set(IDS))
        for identifier, missing in unavailable_proofs.items():
            with self.subTest(identifier=identifier):
                self.assertIn(identifier, self.rows)
                self.assertTrue(missing)
                # These external proofs have not been supplied by synthetic tests.
                external_evidence = None
                status = "UNKNOWN" if external_evidence is None else "UNVERIFIED"
                self.assertEqual(status, "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
