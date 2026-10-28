"""AutoFactory#313: cinco brechas de AGENTES.md; sin certificar runtime.
Las pruebas sintéticas nunca acreditan inspección real, PRs históricos ni live.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
ROWS = (
    "AGENTES-01-21",  # SIN AVANCE: no hay inspección de pestaña real
    "AGENTES-01-22",  # Log: falta observación de todas las superficies
    "AGENTES-02-01",  # Paridad local no demuestra serialización de PRs
    "AGENTES-02-02",  # Configuración no prueba límites en cada PR histórico
    "AGENTES-02-03",  # Observador offline no demuestra runtime integrado
)
UNKNOWN = "UNKNOWN"


def operational_evidence(row: str, observed_runtime: object = None) -> str:
    """Sin fuente autenticada de runtime, los fixtures no son una atestación."""
    # No existe dentro de estas pruebas offline una autoridad para certificar
    # los cinco comportamientos en runtime, incluso con flags autodeclarados.
    return UNKNOWN


def run_node(script: str) -> dict:
    result = subprocess.run(
        ["node", "-e", script], cwd=ROOT,
        check=False, capture_output=True, text=True, timeout=20,
    )
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


class BrechasAutofactory06Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: ejercita semántica local y registra cinco brechas de integración."""
        matrix = (ROOT / "docs/matriz-cobertura.md").read_text(encoding="utf-8")
        for row in ROWS:
            with self.subTest(row=row):
                matching = [line for line in matrix.splitlines()
                            if line.startswith(f"| {row} ·")]
                self.assertEqual(len(matching), 1, row)
                self.assertIn("NO_VERIFICABLE", matching[0])
                self.assertEqual(operational_evidence(row), UNKNOWN)

        # 01-21: umbral local y reinicio por actividad/huella nueva.
        # 01-22: tope real de appendTabHealthLog, sin asumir integración.
        observed = run_node(r"""
const {STATES, classifyTabProgress} = require('./local-tab-progress.js');
const health = require('./account-budget-background.js');
const digest = 'a'.repeat(64);
const fixture = {
  nowMs: 100000, lastActivityAtMs: 1000, fingerprintStableSinceMs: 2000,
  thresholdMs: 60000, previousFingerprint: digest, fingerprint: digest,
  activityObserved: false
};
let log = [];
for (let i = 0; i < 245; i++) {
  log = health.appendTabHealthLog(log, {
    tabId: 7, type: 'send', at: i + 1, fingerprint: '1234abcd'
  });
}
process.stdout.write(JSON.stringify({
  stalled: classifyTabProgress(fixture),
  recent: classifyTabProgress({...fixture, lastActivityAtMs: 99999}),
  changed: classifyTabProgress({...fixture, fingerprint: 'b'.repeat(64)}),
  states: STATES, logCount: log.length
}));
""")
        self.assertEqual(observed["stalled"], observed["states"]["NO_PROGRESS"])
        self.assertEqual(observed["recent"], observed["states"]["ACTIVE"])
        self.assertEqual(observed["changed"], observed["states"]["ACTIVE"])
        self.assertEqual(observed["logCount"], 200)

        # 02-01: paridad de popup, NO ausencia de colisiones entre PRs.
        safari = ROOT / "safari/ChatGPT Autopilot Local Extension/Resources/popup.js"
        self.assertEqual((ROOT / "popup.js").read_bytes(), safari.read_bytes())
        # 02-02: límite configurado, NO auditoría del historial de PRs.
        decisions = json.loads((ROOT / "decisiones.yml").read_text(encoding="utf-8"))
        self.assertEqual(decisions["review_round_limit"], 3)
        self.assertIn("Máximo diez commits", (ROOT / "AGENTES.md").read_text(encoding="utf-8"))
        # 02-03: el caller sólo observa reservas; nunca certifica runtime.
        observer = (ROOT / "docs/OBSERVADOR-RESERVAS-V3.md").read_text(encoding="utf-8")
        self.assertIn("solo lectura", observer)
        self.assertIn("NO", observer)

    def test_falla_cerrado(self) -> None:
        """AC-02: faltantes y ambigüedades resultan UNKNOWN, nunca éxito."""
        result = run_node(r"""
const {STATES, classifyTabProgress} = require('./local-tab-progress.js');
const digest = 'a'.repeat(64);
const valid = {
  nowMs: 100000, lastActivityAtMs: 0, fingerprintStableSinceMs: 0,
  thresholdMs: 60000, previousFingerprint: digest, fingerprint: digest
};
process.stdout.write(JSON.stringify({
  unknown: STATES.UNKNOWN,
  missing: classifyTabProgress(null),
  invalidThreshold: classifyTabProgress({...valid, thresholdMs: 0}),
  ambiguousDigest: classifyTabProgress({...valid, fingerprint: 'plaintext'}),
  missingTime: classifyTabProgress({...valid, nowMs: undefined})
}));
""")
        for field in ("missing", "invalidThreshold", "ambiguousDigest", "missingTime"):
            with self.subTest(field=field):
                self.assertEqual(result[field], result["unknown"])
        for row in ROWS:
            with self.subTest(row=row):
                for claim in (None, {}, {"source": "offline"},
                              {"observed_runtime": True},
                              {"source": "runtime", "status": "VERDE"}):
                    self.assertEqual(operational_evidence(row, claim), UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        """AC-03: payload sintético jamás persiste; log conserva 200 eventos."""
        result = run_node(r"""
const health = require('./account-budget-background.js');
const marker = 'SYNTHETIC-SENSITIVE-NOT-PERSISTED';
let log = [];
for (let i = 0; i < 207; i++) {
  log = health.appendTabHealthLog(log, {
    tabId: 3, at: i + 1, type: 'reply', fingerprint: 'abcdef12',
    conversationText: marker, token: marker, conversationId: marker
  });
}
process.stdout.write(JSON.stringify({count: log.length, serialized: JSON.stringify(log)}));
""")
        self.assertEqual(result["count"], 200)
        for field in ("SYNTHETIC-SENSITIVE-NOT-PERSISTED", "conversationText",
                      "conversationId", "token"):
            with self.subTest(field=field):
                self.assertNotIn(field, result["serialized"])

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: cada fila declara exactamente qué evidencia real falta."""
        reasons = {
            "AGENTES-01-21": "no se inspeccionó una pestaña real",
            "AGENTES-01-22": "no se observaron todas las superficies del log",
            "AGENTES-02-01": "no hay traza de PRs concurrentes",
            "AGENTES-02-02": "no se auditó cada PR histórico",
            "AGENTES-02-03": "no se observó runtime integrado",
        }
        self.assertEqual(set(reasons), set(ROWS))
        for row, reason in reasons.items():
            with self.subTest(row=row):
                self.assertTrue(reason)
                self.assertEqual(operational_evidence(row, reason), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
