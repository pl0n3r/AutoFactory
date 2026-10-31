"""#435: reproducible offline checks for unpaired requirements (no live traffic)."""
from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
LEDGER = ROOT / "docs/candidatas-pendientes-autofactory.md"
OBSERVER = ROOT / ".github/workflows/observador-reservas-consumidor.yml"
TICK = chr(96)

SELECTED = {
    "DOC-OBSERVADOR-RESERVAS-V3-01": "observer-readonly",
    "DOC-OFFLINE-SESSION-STATE-DENIALS-02": "keepalive-denials",
    "README-08-03": "keepalive-budget",
    "README-08-07": "activation-gates",
    "README-13-01": "learning-minimization",
    "README-13-02": "learning-minimization",
    "README-13-04": "reliability-backoff",
    "README-13-06": "keepalive-denials",
}
HEADER = "## Inventario completo SIN_CANDIDATA (#435)"
ROW = re.compile(
    r"^\| " + TICK + r"(?P<id>[A-Z0-9-]+)" + TICK + r" \| "
    r"(?P<group>PARCIAL_OFFLINE|PENDIENTE_OFFLINE|OPERATIVO_EXTERNO|NORMA_DOCUMENTAL)"
    r" \| (?P<proof>—|" + TICK + r"test_criterio_principal#[a-z-]+" + TICK + r") \|$"
)
MATRIX_ROW = re.compile(
    r"^\| " + TICK + r"(?P<id>[A-Z0-9-]+)" + TICK + r" \| "
    r"(?P<verdict>CANDIDATA_LOCAL|SIN_CANDIDATA|DESCARTADO) \| "
    r"(?P<code>[^|]+) \| (?P<test>[^|]+) \|$"
)
MAIN_ID = re.compile(r"^(?:AF1-AC|README|AGENTES|PROTO|DOC|ISSUE|DEC|HIST)-[A-Z0-9-]+$")

def group_for(ident: str) -> str:
    if ident in SELECTED:
        return "PARCIAL_OFFLINE"
    if (re.match(r"^(?:README-(?:01|02|03|07|09|12)-|ISSUE-)", ident)
        or re.match(r"^(?:DOC-(?:RELEASE-EVIDENCE|RELEASE-SECURITY|CI-EXTENSION-SECURITY|SONAR-CHECK-DETAILS)|DOC-OBSERVADOR-RESERVAS-V3-0[23]|DOC-OFFLINE-SESSION-STATE-DENIALS-04|DOC-SESSION-KEEPALIVE-02)", ident)
        or ident == "README-10-02"):
        return "OPERATIVO_EXTERNO"
    if re.match(r"^(?:DEC-|AGENTES-|README-(?:05|06|10|11)-)", ident):
        return "NORMA_DOCUMENTAL"
    return "PENDIENTE_OFFLINE"

def candidate_rows(text: str) -> dict[str, str]:
    if text.count("## Candidatas por requisito (#432)") != 1:
        raise ValueError("Matrix source missing or duplicated")
    rows = {}
    for line in text.split("## Candidatas por requisito (#432)", 1)[1].splitlines():
        if not line.startswith("| " + TICK):
            continue
        match = MATRIX_ROW.fullmatch(line)
        if not match:
            raise ValueError("Invalid matrix candidate row")
        ident = match["id"]
        if ident in rows:
            raise ValueError("Duplicated matrix ID")
        rows[ident] = match["verdict"]
    return rows

def historic_rows(text: str) -> dict[str, str]:
    rows = {}
    for line in text.split("## Candidatas por requisito (#432)", 1)[0].splitlines():
        if not line.startswith("| "):
            continue
        parts = [value.strip() for value in line[1:-1].split("|")]
        if len(parts) != 5:
            continue
        ident = parts[0].split(" · ", 1)[0]
        if not MAIN_ID.fullmatch(ident):
            continue
        if ident in rows:
            raise ValueError("Duplicated historical ID")
        rows[ident] = parts[2]
    return rows

def ledger_rows(text: str) -> dict[str, tuple[str, str]]:
    if text.count(HEADER) != 1:
        raise ValueError("Ledger section missing or duplicated")
    section = text.split(HEADER, 1)[1].split("\n## ", 1)[0]
    rows = {}
    for line in section.splitlines():
        if not line.startswith("| " + TICK):
            continue
        match = ROW.fullmatch(line)
        if not match:
            raise ValueError("Malformed ledger row")
        ident = match["id"]
        if ident in rows:
            raise ValueError("Duplicated ledger ID")
        rows[ident] = match["group"], match["proof"]
    return rows

NODE_CONTRACTS = r"""
'use strict';
const assert = require('node:assert/strict');
const keepalive = require('./factory-control-session-keepalive.js');
const learning = require('./learning.js');
const reliability = require('./reliability.js');
const {createActivationPreflight} = require('./factory-control-activation.js');
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
(async () => {
  // DOC-OFFLINE-SESSION-STATE-DENIALS-02 / README-13-06.
  assert.equal(keepalive.evaluate(snapshot(), NOW).action, 'reenganchar');
  for (const mutate of [
    s => { s.controls.session_closed = true; },
    s => { s.controls.kill_switch_running = false; },
    s => { s.chat.last_activity_s = NOW + 1; },
    s => { s.chat.identical_read_count = 1; }
  ]) {
    const current = snapshot();
    mutate(current);
    assert.notEqual(keepalive.evaluate(current, NOW).action, 'reenganchar');
  }
  // README-08-03: 80% observed budget and an unknown limit fail closed.
  const over = snapshot();
  over.account.msgs_hour = 32;
  assert.deepEqual(
    [keepalive.evaluate(over, NOW).action,
     keepalive.evaluate(over, NOW).idle_reason],
    ['detener', 'limite_horario']
  );
  const unknown = snapshot();
  unknown.account.observed_limit_hour = 0;
  assert.equal(keepalive.evaluate(unknown, NOW).idle_reason, 'desconocido');
  // README-13-01/02: bounded numeric metrics; no chat text or token.
  const sentinel = 'SYNTHETIC_SECRET_NOT_FOR_LOG';
  const memory = learning.normalize({
    cycles: 2, startupSamplesMs: Array(62).fill(1300),
    responseSamplesMs: [1000, -1, NaN, 3000],
    conversation_id: sentinel, text: sentinel, token: sentinel
  });
  assert.equal(memory.startupSamplesMs.length, 50);
  assert.deepEqual(memory.responseSamplesMs, [1000, 3000]);
  assert.equal(JSON.stringify(memory).includes(sentinel), false);
  // README-13-04: circuit breaker after repeated failures.
  let state = reliability.normalize();
  for (let i = 0; i < reliability.MAX_FAILURES; i++) {
    state = reliability.afterFailure(state, 50000);
  }
  assert.equal(state.consecutiveFailures, reliability.MAX_FAILURES);
  assert.equal(reliability.canReload(state, 50000), false);
  assert.equal(reliability.afterSuccess(state).consecutiveFailures, 0);
  // README-08-07: real activation requires the legal gate.
  const ms = 1800000000000;
  const gate = createActivationPreflight({
    now: () => ms,
    loadVerifiedPairing: async ({profileAlias}) => ({
      profileAlias, id:'fixture-pairing-001', expiresAt:ms + 60000, revoked:false
    }),
    loadVerifiedHeartbeatConsent: async ({profileAlias}) => ({
      profileAlias, purpose:'heartbeat', enabled:true, revoked:false,
      expiresAt:ms + 60000
    }),
    loadVerifiedLegalGate: async () => null
  });
  const refused = await gate.evaluate({profileAlias:'offline-only'});
  assert.deepEqual(refused, {allowed:false, code:'legal_blocked'});
  assert.equal(JSON.stringify(refused).includes('fixture-pairing-001'), false);
})().catch(err => { console.error(err); process.exitCode = 1; });
"""

class CandidatasPendientesAutofactoryTests(unittest.TestCase):
    def verify_ledger(self, matrix: str, report: str) -> None:
        source = candidate_rows(matrix)
        historic = historic_rows(matrix)
        self.assertEqual(189, len(source))
        self.assertEqual(set(source), set(historic))
        self.assertEqual(
            Counter(historic.values()),
            Counter({"NO_VERIFICABLE": 158, "CUBIERTO": 22,
                     "DESCARTADO": 8, "EN_CURSO": 1})
        )
        missing = {ident for ident, verdict in source.items()
                   if verdict == "SIN_CANDIDATA"}
        self.assertEqual(131, len(missing))
        self.assertEqual(set(ledger_rows(report)), missing)
        for ident, (group, proof) in ledger_rows(report).items():
            with self.subTest(ident=ident):
                self.assertEqual(group, group_for(ident))
                expected = (TICK + "test_criterio_principal#" + SELECTED[ident] + TICK
                            if ident in SELECTED else "—")
                self.assertEqual(proof, expected)
        self.assertIn("NO_VERIFICABLE", report)
        self.assertIn("No es un certificado de runtime", report)

    def verify_observer(self, text: str) -> None:
        self.assertIn("pl0n3r/Factory/.github/workflows/observador-reservas-consumidor.yml@v1", text)
        self.assertIn("cancel-in-progress: false", text)
        scopes = re.findall(
            r"(?m)^\s+(contents|issues|pull-requests|checks|actions): (read|write)$",
            text
        )
        self.assertEqual(10, len(scopes))
        self.assertEqual({"contents", "issues", "pull-requests", "checks", "actions"},
                         {name for name, _ in scopes})
        self.assertTrue(all(permission == "read" for _, permission in scopes))
        self.assertNotRegex(text, r"(?m)^\s*(?:secrets|steps|run):")

    def test_criterio_principal(self) -> None:
        self.verify_ledger(
            MATRIX.read_text(encoding="utf-8"),
            LEDGER.read_text(encoding="utf-8"),
        )
        self.verify_observer(OBSERVER.read_text(encoding="utf-8"))
        completed = subprocess.run(
            ["node", "-e", NODE_CONTRACTS], cwd=ROOT, text=True,
            capture_output=True, timeout=30, check=False
        )
        self.assertEqual(0, completed.returncode,
                         "Offline contracts failed: " + completed.stderr[-1200:])

    def test_rechaza_promociones_duplicados_y_evidencia_ficticia(self) -> None:
        matrix = MATRIX.read_text(encoding="utf-8")
        report = LEDGER.read_text(encoding="utf-8")
        rows = ledger_rows(report)
        first = next(iter(rows))
        invented = report.replace(
            "| " + TICK + first + TICK + " |",
            "| " + TICK + "ID-INVENTADO" + TICK + " |", 1
        )
        duplicate = report + "\n" + HEADER + "\n"
        missing_proof = report.replace(
            TICK + "test_criterio_principal#observer-readonly" + TICK, "—", 1
        )
        false_promotion = report.replace("| PARCIAL_OFFLINE |", "| CUBIERTO |", 1)
        observer = OBSERVER.read_text(encoding="utf-8")
        unsafe_scopes = observer.replace("contents: read", "contents: write", 1)
        unsafe_concurrency = observer.replace(
            "cancel-in-progress: false", "cancel-in-progress: true", 1
        )

        # Exactly one potentially raising call per assertion scope (Sonar S2699).
        with self.assertRaises(AssertionError):
            self.verify_ledger(matrix, invented)
        with self.assertRaises(ValueError):
            ledger_rows(duplicate)
        with self.assertRaises(AssertionError):
            self.verify_ledger(matrix, missing_proof)
        with self.assertRaises(ValueError):
            ledger_rows(false_promotion)
        with self.assertRaises(AssertionError):
            self.verify_observer(unsafe_scopes)
        with self.assertRaises(AssertionError):
            self.verify_observer(unsafe_concurrency)


if __name__ == "__main__":
    unittest.main()
