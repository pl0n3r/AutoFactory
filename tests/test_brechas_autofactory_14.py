#!/usr/bin/env python3
"""AutoFactory #321: five synthetic, fail-closed coverage contracts.

An offline contract test is not evidence of authenticated ControlBot traffic,
release approval, live readiness, or resolution of the SonarCloud incident.
Only this test module is within the V3 reservation's changed-path claim.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = ("ISSUE-216", "ISSUE-219", "ISSUE-258", "PROTO-01", "PROTO-02")
UNKNOWN = "UNKNOWN"
MATRIX = ROOT / "docs/matriz-cobertura.md"
COORD = ROOT / ".github/workflows/coordinacion.yml"
SONAR = ROOT / ".github/workflows/sonar-check-details.yml"
CHECKLIST = ROOT / "docs/lista-salida-produccion.md"
PROTOCOL_DOC = ROOT / "docs/factory-control-protocol.md"
PROTOCOL_SRC = ROOT / "factory-control-protocol.js"

NODE_HARNESS = r"""
'use strict';
const assert = require('node:assert/strict');
const protocol = require('./factory-control-protocol.js');
const SID = '123e4567-e89b-42d3-a456-426614174000';
const SENTINEL = 'SYNTHETIC_PRIVATE_PAYLOAD_DO_NOT_EXPORT';
const base = {
  version: 2, kind: 'command', id: 'synthetic_cmd',
  instanceId: SID, action: 'pause', target: 'instance',
  issuedAt: 1000, expiresAt: 61000,
};
assert.equal(protocol.VERSION, 1);
assert.equal(protocol.VERSION_2, 2);
assert.equal(protocol.MAX_INSTANCE_COMMAND_TTL_MS, 300000);
const heartbeat = protocol.heartbeat({
  profileAlias: 'synthetic-profile',
  accountAlias: 'synthetic-account',
  tabs: [{tabId: 7, enabled: false, state: 'paused'}]
});
assert.deepEqual(heartbeat.accountState, {state: 'unknown', resetAt: null});
assert.equal(protocol.command({id: 'offline_1', action: 'pause', target: 'all'}).action, 'pause');
assert.throws(() => protocol.command({
  id: 'offline_2', action: 'send_message', target: 'all',
  payload: {text: SENTINEL}
}), TypeError);
assert.throws(() => protocol.heartbeat({
  profileAlias: 'synthetic-profile', accountAlias: 'synthetic-account',
  tabs: [], conversationText: SENTINEL
}), TypeError);
const c = protocol.commandV2(base);
assert.equal(c.instanceId, SID);
assert.equal(c.target, 'instance');
assert.equal(c.action, 'pause');
assert.deepEqual(protocol.presenceV2({
  version: 2, kind: 'presence', instanceId: SID,
  enabled: false, tabs: [{tabId: 7, enabled: false}], observedAt: 1000
}).tabs, [{tabId: 7, enabled: false}]);
const ack = protocol.acknowledgementV2({
  version: 2, kind: 'ack', id: 'synthetic_cmd', instanceId: SID,
  ok: false, code: 'unauthorized', enabled: false, appliedTabs: []
});
assert.equal(ack.code, 'unauthorized');
assert.throws(() => protocol.commandV2({...base, payload: {text: SENTINEL}}), TypeError);
assert.throws(() => protocol.commandV2({...base, expiresAt: 301001}), TypeError);
assert.throws(() => protocol.commandV2({...base, action: 'send_message'}), TypeError);
assert.throws(() => protocol.commandV2({...base, instanceId: 'invalid'}), TypeError);
assert.throws(() => protocol.commandV2({...base, target: 'all'}), TypeError);
assert.throws(() => protocol.acknowledgementV2({
  version: 2, kind: 'ack', id: 'synthetic_cmd', instanceId: SID,
  ok: true, code: 'failed', enabled: false, appliedTabs: []
}), TypeError);
const result = JSON.stringify({command: c, acknowledgement: ack, heartbeat});
assert.equal(result.includes(SENTINEL), false);
console.log(JSON.stringify({
  'PROTO-01': protocol.VERSION === 1 && protocol.VERSION_2 === 2
    && heartbeat.accountState.state === 'unknown' && c.action === 'pause',
  'PROTO-02': c.target === 'instance'
    && ack.code === 'unauthorized' && !result.includes(SENTINEL)
}));
"""


def verified(value: object) -> str:
    """Neither a missing value nor a string such as 'true' is evidence."""
    return "TEST_EXECUTED" if value is True else UNKNOWN


def matrix_state(source: str, requirement: str) -> str:
    """A missing, duplicate, or malformed row has no trustworthy status."""
    rows = [
        line for line in source.splitlines()
        if line.startswith("| " + requirement + " ·")
    ]
    if len(rows) != 1:
        return UNKNOWN
    cells = [cell.strip() for cell in rows[0].strip().strip("|").split("|")]
    if len(cells) != 6:
        return UNKNOWN
    return cells[2] if cells[2] in {
        "NO_VERIFICABLE", "CUBIERTO", "EN_CURSO",
        "SIN_COBERTURA", "DESCARTADO"
    } else UNKNOWN


def run_offline(command: list[str], *, timeout: int = 60) -> str:
    """Drop environment-supplied credentials, proxies, tokens and home state."""
    environment = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    completed = subprocess.run(
        command, cwd=ROOT, env=environment, capture_output=True,
        text=True, check=False, timeout=timeout
    )
    if completed.returncode != 0:
        # Do not leak incidental subprocess output or provider-like secrets.
        raise AssertionError("Offline contract subprocess did not pass: "
                             + command[0])
    return completed.stdout


def source_contract(path: Path, fragments: tuple[str, ...]) -> bool:
    if not path.is_file():
        return False
    text = path.read_text(encoding="utf-8")
    return all(part in text for part in fragments)


def offline_evidence() -> dict[str, bool]:
    """Execute existing audited offline checks plus a synthetic Node harness."""
    coordination = run_offline([
        sys.executable, "-m", "unittest", "-q",
        "tests.test_coordination_workflow_contract"
    ])
    sonar = run_offline(["node", "test-sonar-check-relay.cjs"])
    checklist = run_offline([
        sys.executable, "-m", "unittest", "-q",
        "tests.test_lista_salida_produccion"
    ])
    response = json.loads(run_offline(["node", "-e", NODE_HARNESS]))
    return {
        "ISSUE-216": source_contract(COORD, (
            "operation: validate",
            "require_reservation:",
            "github.event.pull_request.draft == false",
            "cancel-in-progress: false",
        )) and isinstance(coordination, str),
        "ISSUE-219": source_contract(SONAR, (
            "github.event.check_run.app.slug == 'sonarqubecloud'",
            "github.event.check_run.name == 'SonarCloud Code Analysis'",
            "ref: main",
            "node scripts/sonar-check-relay.cjs",
        )) and isinstance(sonar, str),
        "ISSUE-258": source_contract(CHECKLIST, (
            "Bloquean el go-live",
            "ControlBot",
            "#219",
            "no live",
        )) and isinstance(checklist, str),
        "PROTO-01": response.get("PROTO-01") is True and source_contract(
            PROTOCOL_DOC, ("solamente validadores puros", "No conecta", "## Decisión vigente")
        ),
        "PROTO-02": response.get("PROTO-02") is True and source_contract(
            PROTOCOL_DOC, ("## Módulo compartido", "No se implementa WebSocket")
        ) and source_contract(PROTOCOL_SRC, ("function commandV2(", "function presenceV2(")),
    }


class BrechasAutofactory14Tests(unittest.TestCase):
    def test_contrato_principal(self):
        """AC-01: exercise all five specified offline contracts, not live integration."""
        evidence = offline_evidence()
        self.assertEqual(set(evidence), set(REQUIREMENTS))
        for requirement in REQUIREMENTS:
            with self.subTest(requirement=requirement):
                self.assertEqual(verified(evidence[requirement]), "TEST_EXECUTED")

    def test_falla_cerrado(self):
        """AC-02: missing, partial, duplicate, ambiguous evidence remains UNKNOWN."""
        for requirement in REQUIREMENTS:
            with self.subTest(requirement=requirement):
                for bad in (None, False, "success", "true", 1, {}, []):
                    self.assertEqual(UNKNOWN, verified(bad))
                self.assertEqual(UNKNOWN, matrix_state("", requirement))
        duplicate = (
            "| ISSUE-216 · AutoFactory#216 | Contract | NO_VERIFICABLE | note | issue |\n"
            "| ISSUE-216 · AutoFactory#216 | Contract | CUBIERTO | note | issue |"
        )
        self.assertEqual(UNKNOWN, matrix_state(duplicate, "ISSUE-216"))
        malformed = "| ISSUE-219 · AutoFactory#219 | no state |"
        self.assertEqual(UNKNOWN, matrix_state(malformed, "ISSUE-219"))
        self.assertFalse(source_contract(ROOT / "tests/absent-fixture-321", ("ok",)))

    def test_sin_datos_reales(self):
        """AC-03: local synthetic contracts, no account, network, or credentials."""
        self.assertNotIn("https://", NODE_HARNESS)
        self.assertNotIn("fetch(", NODE_HARNESS)
        self.assertNotIn("process.env", NODE_HARNESS)
        self.assertNotIn("XMLHttpRequest", NODE_HARNESS)
        self.assertIn("SYNTHETIC_PRIVATE_PAYLOAD_DO_NOT_EXPORT", NODE_HARNESS)
        evidence = offline_evidence()
        self.assertEqual(set(evidence), set(REQUIREMENTS))
        self.assertTrue(all(item is True for item in evidence.values()))

    def test_estados_unknown_explicitos(self):
        """AC-04: no rewriting matrix rows or promotion of operational readiness."""
        matrix = MATRIX.read_text(encoding="utf-8")
        self.assertEqual(5, len(REQUIREMENTS))
        self.assertEqual(len(REQUIREMENTS), len(set(REQUIREMENTS)))
        for requirement in REQUIREMENTS:
            with self.subTest(requirement=requirement):
                self.assertEqual("NO_VERIFICABLE", matrix_state(matrix, requirement))
                self.assertEqual(UNKNOWN, verified(None))
        self.assertIn("Estado operativo: UNKNOWN.", matrix)
        self.assertIn("no certifica integración", matrix)
        self.assertIn("no es activación", PROTOCOL_DOC.read_text(encoding="utf-8"))
        self.assertIn("Bloquean el go-live", CHECKLIST.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
