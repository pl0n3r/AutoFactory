#!/usr/bin/env python3
"""AutoFactory #324: contratos offline PROTO-13..17, sin certificar live.

La suite reutiliza las regresiones Node canónicas con fakes: pasar esas
pruebas no demuestra pairing, credenciales, transporte ni consentimiento real.
"""
from __future__ import annotations

import functools
import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
ROWS = ("PROTO-13", "PROTO-14", "PROTO-15", "PROTO-16", "PROTO-17")
UNKNOWN = "UNKNOWN"
LOCAL = "LOCAL_CONTRACT"

# Cada fila tiene una evidencia comportamental y una fuente propia.
CASES = {
    "PROTO-13": (
        "factory-control-response-consent.js",
        "test-factory-control-response-consent.cjs",
        "factory-control response consent: ok",
        ("createResponseConsent", "MAX_FUTURE_MS", "grant.revoked !== false"),
    ),
    "PROTO-14": (
        "factory-control-pairing.js",
        "test-factory-control-pairing.cjs",
        "pairing-postissue AC-01..04: ok",
        ("internalCredentialByResult", "createPersistedPairingContract",
         "credentialStore.save(row)"),
    ),
    "PROTO-15": (
        "factory-control-pairing.js",
        "test-factory-control-pairing.cjs",
        "pairing-audit AC-01: ok",
        ("profileAlias", "credentialStore.remove", "internalPairingOwner"),
    ),
    "PROTO-16": (
        "factory-control-instance-transport.js",
        "test-factory-control-instance-transport.cjs",
        "factory-control local-agent transport boundary: ok",
        ("checkedMetadata", "metadata.authenticated", "handleFrame"),
    ),
    "PROTO-17": (
        "factory-control-instance-transport.js",
        "test-factory-control-instance-transport.cjs",
        "factory-control local-agent transport boundary: ok",
        ("createLocalAgentTransportBoundary", "scheduleReconnect",
         "checkedReceipt"),
    ),
}

# Solo Node puro; sin red, localStorage, cookies, perfiles reales ni cuentas.
NEGATIVE_PROBE = r"""
'use strict';
const consent = require('./factory-control-response-consent.js');
const pairing = require('./factory-control-pairing.js');
const transport = require('./factory-control-instance-transport.js');
const NOW = 500000;
const valid = {profileAlias:'fixture', purpose:'response_return',
  enabled:true, revoked:false, expiresAt:NOW + 10000};
const decide = grant => consent.createResponseConsent({
  now: () => NOW, loadVerifiedConsent:async () => grant
}).authorize({profileAlias:'fixture'});
const raises = fn => {try { fn(); return false; } catch (_) {return true;}};
(async () => {
  const granted = await decide(valid);
  const revoked = await decide({...valid, revoked:true});
  const absent = await decide(null);
  const mismatched = await decide({...valid, profileAlias:'other'});
  const expired = await decide({...valid, expiresAt:NOW});
  const extra = await decide({...valid, conversationText:'not-allowed'});
  process.stdout.write(JSON.stringify({
    consentAllowed:granted.allowed === true && granted.code === 'allowed',
    consentDenied:[revoked,absent,mismatched,expired,extra].every(
      x => x.allowed === false && x.code === 'denied'),
    pairingDependencies:raises(() => pairing.createPairingContract({})),
    persistenceDependencies:raises(() => pairing.createPersistedPairingContract({})),
    transportDependencies:raises(() => transport.createLocalAgentTransportBoundary({})),
    sanitized:Object.keys(granted).sort().join(',') === 'allowed,code' &&
      !JSON.stringify([granted,revoked,absent]).includes('conversationText')
  }));
})().catch(() => { process.exitCode = 1; });
"""


def matrix_rows(text: str) -> dict[str, tuple[str, ...]]:
    found: dict[str, tuple[str, ...]] = {}
    for line in text.splitlines():
        match = re.match(r"^\| (PROTO-\d+) · ", line)
        if not match or match.group(1) not in ROWS:
            continue
        ident = match.group(1)
        if ident in found:
            raise ValueError(f"{ident}: duplicate row")
        cols = tuple(x.strip() for x in line.strip().strip("|").split("|"))
        if len(cols) != 5 or not cols[0].startswith(ident + " · "):
            raise ValueError(f"{ident}: invalid matrix row")
        found[ident] = cols
    return found


def run_node(args: list[str]) -> str:
    run = subprocess.run(
        ["node", *args], cwd=ROOT, check=False, capture_output=True,
        text=True, timeout=120,
    )
    if run.returncode:
        raise AssertionError("Local synthetic Node contract failed")
    return run.stdout


@functools.lru_cache(maxsize=1)
def negative_probe() -> dict[str, bool]:
    result = json.loads(run_node(["-e", NEGATIVE_PROBE]))
    if set(result) != {
        "consentAllowed", "consentDenied", "pairingDependencies",
        "persistenceDependencies", "transportDependencies", "sanitized"
    }:
        raise AssertionError("Synthetic probe contract is incomplete")
    return result


@functools.lru_cache(maxsize=3)
def suite(path: str) -> str:
    if path not in {case[1] for case in CASES.values()}:
        raise ValueError("unknown test suite")
    return run_node([path])


def local_evidence(ident: str, rows: dict[str, tuple[str, ...]],
                   sources: dict[str, str], outputs: dict[str, str],
                   negatives: dict[str, bool]) -> dict[str, str]:
    state = {"code": UNKNOWN, "ci": UNKNOWN, "live": UNKNOWN}
    if ident not in CASES:
        return state
    row, source, output = rows.get(ident), sources.get(ident), outputs.get(ident)
    src_path, script, marker, signatures = CASES[ident]
    if (row is None or len(row) != 5 or row[2] != "NO_VERIFICABLE"
            or "UNKNOWN" not in row[3]
            or not isinstance(source, str) or not isinstance(output, str)
            or not all(m in source for m in signatures)
            or marker not in output or not all(negatives.get(x) is True
              for x in ("consentAllowed", "consentDenied",
                        "pairingDependencies", "persistenceDependencies",
                        "transportDependencies", "sanitized"))):
        return state
    state["code"] = LOCAL
    return state


def fixtures() -> tuple[dict[str, str], dict[str, str]]:
    source_by_row = {
        row: (ROOT / src).read_text(encoding="utf-8")
        for row, (src, _, _, _) in CASES.items()
    }
    output_by_row = {row: suite(script)
                     for row, (_, script, _, _) in CASES.items()}
    return source_by_row, output_by_row


def operational_evidence(ident: str, external: object = None) -> str:
    """Offline results never attest a real browser, authenticated backend or go-live."""
    return UNKNOWN


class BrechasAutofactory17Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        self.assertEqual(set(rows), set(ROWS))
        sources, outputs = fixtures()
        probe = negative_probe()
        for ident in ROWS:
            with self.subTest(requirement=ident):
                self.assertEqual(
                    local_evidence(ident, rows, sources, outputs, probe)["code"],
                    LOCAL
                )

    def test_falla_cerrado(self) -> None:
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        sources, outputs = fixtures()
        probe = negative_probe()
        self.assertTrue(all(probe.values()))
        for ident in ROWS:
            with self.subTest(requirement=ident):
                self.assertEqual(
                    local_evidence(ident, {}, sources, outputs, probe)["code"], UNKNOWN)
                self.assertEqual(
                    local_evidence(ident, rows, {}, outputs, probe)["code"], UNKNOWN)
                self.assertEqual(
                    local_evidence(ident, rows, sources, {}, probe)["code"], UNKNOWN)
                malformed = dict(probe)
                malformed["consentDenied"] = False
                self.assertEqual(
                    local_evidence(ident, rows, sources, outputs, malformed)["code"],
                    UNKNOWN
                )
        self.assertEqual(local_evidence("PROTO-999", rows, sources, outputs, probe)["code"], UNKNOWN)
        raw = next(x for x in MATRIX.read_text(encoding="utf-8").splitlines()
                   if x.startswith("| PROTO-13 · "))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            matrix_rows(raw + "\n" + raw)

    def test_sin_datos_reales(self) -> None:
        self.assertEqual(set(CASES), set(ROWS))
        for word in ("fetch(", "http.request", "https.request", "WebSocket(",
                     "localStorage", "chrome.", "browser.", "process.env",
                     "sendMessage("):
            with self.subTest(forbidden=word):
                self.assertNotIn(word, NEGATIVE_PROBE)
        for ident, (src, script, _, _) in CASES.items():
            with self.subTest(row=ident):
                self.assertTrue((ROOT / src).is_file())
                self.assertTrue((ROOT / script).is_file())
        self.assertNotIn("-----BEGIN " + "PRIVATE KEY-----", NEGATIVE_PROBE)
        self.assertNotIn("https://" + "control.", NEGATIVE_PROBE)
        self.assertEqual(set(negative_probe()), {
            "consentAllowed", "consentDenied", "pairingDependencies",
            "persistenceDependencies", "transportDependencies", "sanitized"
        })

    def test_estados_unknown_explicitos(self) -> None:
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        sources, outputs = fixtures()
        probe = negative_probe()
        for ident in ROWS:
            with self.subTest(row=ident):
                self.assertEqual(rows[ident][2], "NO_VERIFICABLE")
                self.assertIn("UNKNOWN", rows[ident][3])
                self.assertEqual(
                    local_evidence(ident, rows, sources, outputs, probe),
                    {"code": LOCAL, "ci": UNKNOWN, "live": UNKNOWN}
                )
                self.assertEqual(operational_evidence(ident), UNKNOWN)
                self.assertEqual(operational_evidence(ident, {"live": "success"}), UNKNOWN)
                changed = dict(rows)
                altered = list(rows[ident])
                altered[2] = "CUBIERTO"
                changed[ident] = tuple(altered)
                self.assertEqual(
                    local_evidence(ident, changed, sources, outputs, probe)["code"],
                    UNKNOWN
                )


if __name__ == "__main__":
    unittest.main()
