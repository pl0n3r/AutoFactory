#!/usr/bin/env python3
"""AutoFactory #320: contratos de 5 hojas de bridge con evidencia sintética.

La aceptación aquí prueba solamente código/fixtures offline. No acredita
heartbeat autenticado, envío real, sesión real, E2E ni go-live.
"""
from __future__ import annotations

import functools
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
REQUIREMENTS = tuple(f"ISSUE-{number}" for number in range(130, 135))
UNKNOWN = "UNKNOWN"
LOCAL = "LOCAL_CONTRACT"

SOURCES = {
    "ISSUE-130": ROOT / "factory-control-heartbeat.js",
    "ISSUE-131": ROOT / "factory-control-executor.js",
    "ISSUE-132": ROOT / "factory-control-account-state.js",
    "ISSUE-133": ROOT / "factory-control-runtime.js",
    "ISSUE-134": ROOT / "docs/lista-salida-produccion.md",
}
OFFLINE_TESTS = {
    "ISSUE-130": "test-factory-control-heartbeat.cjs",
    "ISSUE-131": "test-factory-control-executor.cjs",
    "ISSUE-132": "test-factory-control-account-state.cjs",
    "ISSUE-133": "test-factory-control-runtime.cjs",
    "ISSUE-134": "tests/test_lista_salida_produccion.py",
}
REQUIRED_MARKERS = {
    "ISSUE-130": (
        "heartbeat-presence AC-01: ok", "heartbeat-presence AC-02: ok",
        "heartbeat-presence AC-03: ok",
    ),
    "ISSUE-131": (
        "Factory Control executor: authorization",
        "Factory Control audit AC-03: sanitized durable decisions",
    ),
    "ISSUE-132": (
        "account-state AC-01: ok", "account-state AC-02: ok",
        "account-state AC-03: ok",
    ),
    "ISSUE-133": ("factory-control runtime lifecycle: ok",),
    "ISSUE-134": ("Ran 4 tests", "OK"),
}
SOURCE_MARKERS = {
    "ISSUE-130": ("MIN_INTERVAL_MS = 60000", "OFFLINE_AFTER_MISSES",
                  "createHeartbeatPresenceCoordinator", "receipt.confirmed !== true"),
    "ISSUE-131": ("createCommandExecutor", "auditStore", "sameCommand", "ledger"),
    "ISSUE-132": ("createProviderAccountStateObserver", "requires_login",
                  "unknownObservation", "maxAgeMs"),
    "ISSUE-133": ("createFactoryControlRuntime", "createInstanceRuntime",
                  "runCommands", "runHeartbeat", "reconciliationPending"),
    "ISSUE-134": ("Bloquean el go-live", "D-061", "ControlBot #20",
                  "DEL_DUEÑO", "SIN_COBERTURA"),
}


def matrix_rows(text: str) -> dict[str, tuple[str, ...]]:
    rows: dict[str, tuple[str, ...]] = {}
    for line in text.splitlines():
        match = re.match(r"^\| (ISSUE-\d+) · ", line)
        if match is None or match.group(1) not in REQUIREMENTS:
            continue
        ident = match.group(1)
        if ident in rows:
            raise ValueError(f"duplicated requirement: {ident}")
        columns = tuple(x.strip() for x in line.strip().strip("|").split("|"))
        if len(columns) != 5 or not columns[0].startswith(ident + " · "):
            raise ValueError(f"malformed requirement: {ident}")
        rows[ident] = columns
    return rows


def read_sources() -> dict[str, str]:
    return {ident: path.read_text(encoding="utf-8") for ident, path in SOURCES.items()}


@functools.lru_cache(maxsize=1)
def run_synthetic_contracts() -> dict[str, str]:
    """Only local Node tests / Python unittest with fake adapters; no I/O to services."""
    outputs: dict[str, str] = {}
    for ident, test_path in OFFLINE_TESTS.items():
        if ident == "ISSUE-134":
            command = ["python3", "-m", "unittest", "-v", "tests.test_lista_salida_produccion"]
        else:
            command = ["node", test_path]
        process = subprocess.run(
            command, cwd=ROOT, capture_output=True, text=True, timeout=60,
            check=False,
        )
        if process.returncode != 0:
            raise AssertionError(f"{ident}: offline contract did not pass")
        outputs[ident] = process.stdout + process.stderr
    return outputs


def evidence(ident: str, rows: dict[str, tuple[str, ...]],
             sources: dict[str, str], outputs: dict[str, str] | None) -> dict[str, str]:
    verdict = {"code": UNKNOWN, "ci": UNKNOWN, "live": UNKNOWN}
    if ident not in REQUIREMENTS or not isinstance(outputs, dict):
        return verdict
    row = rows.get(ident)
    source = sources.get(ident)
    output = outputs.get(ident)
    if (row is None or len(row) != 5 or row[2] != "NO_VERIFICABLE"
            or not isinstance(source, str) or not source
            or not isinstance(output, str) or not output):
        return verdict
    if not all(marker in source for marker in SOURCE_MARKERS[ident]):
        return verdict
    if not all(marker in output for marker in REQUIRED_MARKERS[ident]):
        return verdict
    # No synthetic output can elevate the operational or release claim.
    verdict["code"] = LOCAL
    return verdict


class BrechasAutofactory13Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        self.assertEqual(set(rows), set(REQUIREMENTS))
        sources, outputs = read_sources(), run_synthetic_contracts()
        for ident in REQUIREMENTS:
            with self.subTest(requirement=ident):
                self.assertEqual(evidence(ident, rows, sources, outputs)["code"], LOCAL)

    def test_falla_cerrado(self) -> None:
        text = MATRIX.read_text(encoding="utf-8")
        rows, sources, outputs = matrix_rows(text), read_sources(), run_synthetic_contracts()
        self.assertEqual(evidence("ISSUE-999", rows, sources, outputs)["code"], UNKNOWN)
        for ident in REQUIREMENTS:
            with self.subTest(requirement=ident):
                self.assertEqual(evidence(ident, {}, sources, outputs)["code"], UNKNOWN)
                self.assertEqual(evidence(ident, rows, {}, outputs)["code"], UNKNOWN)
                self.assertEqual(evidence(ident, rows, sources, None)["code"], UNKNOWN)
                bad_output = dict(outputs)
                bad_output[ident] = "ok"  # Una respuesta inventada no es evidencia.
                self.assertEqual(evidence(ident, rows, sources, bad_output)["code"], UNKNOWN)
                bad_source = dict(sources)
                bad_source[ident] = ""
                self.assertEqual(evidence(ident, rows, bad_source, outputs)["code"], UNKNOWN)
        first = next(line for line in text.splitlines() if line.startswith("| ISSUE-130 · "))
        with self.assertRaisesRegex(ValueError, "duplicated"):
            matrix_rows(first + "\n" + first)
        with self.assertRaisesRegex(ValueError, "malformed"):
            matrix_rows("| ISSUE-130 · invalido | columna faltante |")

    def test_sin_datos_reales(self) -> None:
        # No invoca extensiones, ControlBot, navegadores reales ni tráfico HTTP.
        self.assertEqual(set(OFFLINE_TESTS), set(REQUIREMENTS))
        self.assertEqual(
            {x for x in OFFLINE_TESTS.values() if x.endswith(".cjs")},
            {"test-factory-control-heartbeat.cjs", "test-factory-control-executor.cjs",
             "test-factory-control-account-state.cjs", "test-factory-control-runtime.cjs"},
        )
        self.assertTrue(all((ROOT / path).is_file() for path in OFFLINE_TESTS.values()))
        own = Path(__file__).read_text(encoding="utf-8")
        self.assertNotRegex(own, r"(?m)^(?:import|from)\s+(?:requests|httpx|urllib|socket)\b")
        self.assertNotIn("-----BEGIN " + "PRIVATE KEY-----", own)
        self.assertNotIn("api.github.com/" + "repos/", own)
        self.assertEqual(set(run_synthetic_contracts()), set(REQUIREMENTS))

    def test_estados_unknown_explicitos(self) -> None:
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        sources, outputs = read_sources(), run_synthetic_contracts()
        for ident in REQUIREMENTS:
            with self.subTest(requirement=ident):
                self.assertEqual(rows[ident][2], "NO_VERIFICABLE")
                self.assertIn("UNKNOWN", rows[ident][3])
                self.assertEqual(evidence(ident, rows, sources, outputs), {
                    "code": LOCAL, "ci": UNKNOWN, "live": UNKNOWN,
                })
                forged = dict(rows)
                columns = list(rows[ident])
                columns[2] = "CUBIERTO"
                forged[ident] = tuple(columns)
                self.assertEqual(evidence(ident, forged, sources, outputs)["code"], UNKNOWN)


if __name__ == "__main__":
    unittest.main()
