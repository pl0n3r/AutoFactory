#!/usr/bin/env python3
"""AutoFactory#323: pruebas offline para PROTO-08..12.

No se conecta a ControlBot ni al navegador. Ejercita módulos puros y las suites
Node sintéticas existentes, pero la evidencia de operación real sigue UNKNOWN.
"""
from __future__ import annotations

import json
import re
import subprocess
import unittest
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
ROWS = ("PROTO-08", "PROTO-09", "PROTO-10", "PROTO-11", "PROTO-12")
UNKNOWN = "UNKNOWN"
# Suites de regresión reales; no se acepta una presencia textual como evidencia.
SUITES = {
    "PROTO-08": (
        "test-factory-control-heartbeat.cjs",
        "Factory Control heartbeat: consent, 60s cadence, revocation and safe failures pass",
    ),
    "PROTO-09": (
        "test-factory-control-executor.cjs",
        "Factory Control executor: authorization, durable idempotency, effect isolation and safe ACKs pass",
    ),
    "PROTO-10": (
        "test-factory-control-pairing.cjs",
        "factory-control pairing contract: ok",
    ),
    "PROTO-11": (
        "test-factory-control-transport.cjs",
        "factory-control transport contract: ok",
    ),
    "PROTO-12": (
        "test-factory-control-account-state.cjs",
        "factory-control account state contract: ok",
    ),
}

# No endpoints, fetch, sockets, browser APIs, external adapters or real data.
# Run actual exported contracts against entirely synthetic input.
NEGATIVE_PROBE = r"""
'use strict';
const hb = require('./factory-control-heartbeat.js');
const executor = require('./factory-control-executor.js');
const pairing = require('./factory-control-pairing.js');
const transport = require('./factory-control-transport.js');
const account = require('./factory-control-account-state.js');
const throws = fn => { try { fn(); return false; } catch (_) { return true; } };
(async () => {
  let adapterCalls = 0;
  const pairingContract = pairing.createPairingContract({
    loadVerifiedChallenge: async () => { adapterCalls++; return null; },
    consumeVerifiedChallenge: async () => { adapterCalls++; return 'failed'; },
    issueOpaqueCredential: async () => { adapterCalls++; return null; },
    revokeOpaqueCredential: async () => { adapterCalls++; return false; },
    now: () => 100000
  });
  const rejected = await pairingContract.pair({profileAlias:'fixture', code:'invalid'});
  const protocol = {
    heartbeat: input => input,
    command: input => input,
    acknowledgement: input => input
  };
  const http = transport.createTransportContract({protocol, longPollMs:25000});
  const descriptor = http.nextCommandRequest({profileAlias:'fixture', cursor:null});
  const invalidState = account.classifyAccountState(null, () => 100000);
  const conflictingState = account.classifyAccountState({
    authenticated:false, usageLimited:true, providerError:false, resetAt:null
  }, () => 100000);
  const validState = account.classifyAccountState({
    authenticated:true, usageLimited:false, providerError:false, resetAt:null
  }, () => 100000);
  const invalidObserver = await account.createProviderAccountStateObserver({
    readProviderSignal:async () => ({
      signalCode:'ready', alertText:null, observedAt:1
    }), now: () => 100000, maxAgeMs:1000
  }).read();
  process.stdout.write(JSON.stringify({
    'PROTO-08': throws(() => hb.createHeartbeatPresenceCoordinator({})) &&
      throws(() => hb.buildHeartbeatSnapshot(null)),
    'PROTO-09': throws(() => executor.createCommandExecutor({})),
    'PROTO-10': rejected.ok === false && rejected.code === 'invalid' &&
      Object.keys(rejected).sort().join(',') === 'code,ok' && adapterCalls === 0,
    'PROTO-11': throws(() => transport.createTransportContract({})) &&
      throws(() => transport.createTransportContract({protocol, longPollMs:1})) &&
      descriptor.origin.startsWith('https://') && descriptor.method === 'GET' &&
      descriptor.path === '/v1/bridge/commands/next' &&
      descriptor.authScope === 'profile' &&
      descriptor.query.waitMs === 25000 &&
      Object.isFrozen(descriptor),
    'PROTO-12': invalidState.state === 'unknown' &&
      conflictingState.state === 'unknown' &&
      invalidObserver.state === 'unknown' &&
      invalidObserver.freshness === 'stale' &&
      validState.state === 'ready',
    'negativeStates': {
      account:invalidState.state,
      conflicting:conflictingState.state,
      stale:invalidObserver.state,
      rejectedPairing:rejected.code
    }
  }));
})().catch(() => {process.exitCode = 1;});
"""


def operational_evidence(row: str, synthetic: object = None) -> str:
    """A synthetic adapter can never attest real consent, transport or runtime."""
    return UNKNOWN


def _run_node(args: list[str], timeout: int = 90) -> str:
    p = subprocess.run(
        ["node", *args], cwd=ROOT, check=False, text=True,
        capture_output=True, timeout=timeout,
    )
    if p.returncode != 0:
        raise AssertionError("Offline Node contract failed: " + " ".join(args[:1]))
    return p.stdout


@lru_cache(maxsize=1)
def probe() -> dict:
    return json.loads(_run_node(["-e", NEGATIVE_PROBE], timeout=25))


@lru_cache(maxsize=None)
def suite(row: str) -> str:
    filename, _ = SUITES[row]
    return _run_node([filename])


def rows_from_matrix() -> dict[str, list[str]]:
    found = {}
    for line in MATRIX.read_text(encoding="utf-8").splitlines():
        for row in ROWS:
            if line.startswith(f"| {row} ·"):
                if row in found:
                    raise AssertionError(row + ": fila duplicada")
                found[row] = [v.strip() for v in line.strip().strip("|").split("|")]
    return found


class BrechasAutofactory16Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: cinco implementaciones ejecutadas, una evidencia por fila."""
        self.assertEqual(set(SUITES), set(ROWS))
        negatives = probe()
        for row, (_, marker) in SUITES.items():
            with self.subTest(row=row):
                self.assertIn(marker, suite(row))
                self.assertIs(negatives[row], True, row + ": negative contract")
                self.assertEqual(operational_evidence(row), UNKNOWN)

    def test_falla_cerrado(self) -> None:
        """AC-02: invalid/ambiguous inputs never authorize side effects."""
        result = probe()
        for row in ROWS:
            with self.subTest(row=row):
                self.assertTrue(result[row])
        self.assertEqual(result["negativeStates"], {
            "account": "unknown",
            "conflicting": "unknown",
            "stale": "unknown",
            "rejectedPairing": "invalid",
        })
        for row in ROWS:
            with self.subTest(fake_attestation=row):
                self.assertEqual(
                    operational_evidence(row, {"success": True, "live": True}),
                    UNKNOWN,
                )

    def test_sin_datos_reales(self) -> None:
        """AC-03: local-only fixtures; no real identities or network requests."""
        self.assertNotIn("fetch(", NEGATIVE_PROBE)
        self.assertNotIn("http.request", NEGATIVE_PROBE)
        self.assertNotIn("https.request", NEGATIVE_PROBE)
        self.assertNotIn("WebSocket(", NEGATIVE_PROBE)
        self.assertNotIn("sendMessage(", NEGATIVE_PROBE)
        self.assertNotIn("localStorage", NEGATIVE_PROBE)
        self.assertNotIn("process.env", NEGATIVE_PROBE)
        observations = json.dumps(probe())
        for forbidden in ("access_token", "session_cookie", "chat_id",
                          "conversation_id", "email@", "Bearer "):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, observations)
        self.assertIn("fixture", NEGATIVE_PROBE)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: a passing offline contract is not a production assertion."""
        rows = rows_from_matrix()
        self.assertEqual(set(rows), set(ROWS))
        for row, columns in rows.items():
            with self.subTest(row=row):
                self.assertEqual(len(columns), 5)
                self.assertIn(columns[2], {"NO_VERIFICABLE", "EN_CURSO", "CUBIERTO"})
                if columns[2] == "NO_VERIFICABLE":
                    self.assertIn("UNKNOWN", columns[3])
                self.assertEqual(operational_evidence(row), UNKNOWN)
                self.assertEqual(operational_evidence(row, probe()[row]), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
