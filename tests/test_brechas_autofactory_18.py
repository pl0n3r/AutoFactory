#!/usr/bin/env python3
"""AutoFactory #325: evidencia offline para PROTO-18..PROTO-22.

Las pruebas ejercitan contratos Node existentes con fixtures sintéticos. Nunca
acreditan puente activo, señales de cuenta reales ni tráfico a ControlBot.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
UNKNOWN = "UNKNOWN"

# Identificador, fuente real, prueba del contraste, suite ejecutable, éxito, negativo.
GAPS = (
    ("PROTO-18", "factory-control-runtime.js", "tests/test_factory_control_runtime.py",
     "test-factory-control-runtime.cjs", "factory-control runtime lifecycle: ok",
     "factory-control instance runtime: wrong-instance revoked and expired fail closed"),
    ("PROTO-19", "factory-control-account-state.js",
     "tests/test_factory_control_account_state.py",
     "test-factory-control-account-state.cjs",
     "factory-control account state contract: ok", "account-state AC-03: ok"),
    ("PROTO-20", "factory-control-activation.js",
     "tests/test_factory_control_readiness_report.py",
     "test-factory-control-activation.cjs",
     "factory-control activation preflight: ok",
     "factory-control activation preflight: ok"),
    ("PROTO-21", "factory-control-heartbeat.js",
     "tests/test_factory_control_heartbeat_presence.py",
     "test-factory-control-heartbeat.cjs",
     "Factory Control heartbeat: consent, 60s cadence, revocation and safe failures pass",
     "heartbeat-presence AC-03: ok"),
    ("PROTO-22", "factory-control-account-state-freshness.js",
     "tests/test_account_state_freshness_offline.py",
     "test-factory-control-account-state-freshness.cjs",
     "AC-01: ok", "AC-02: ok"),
)


def matrix_rows(source: str) -> dict[str, list[str]]:
    """Only one full five-column row per ID counts as matrix evidence."""
    result: dict[str, list[str]] = {}
    for identifier, *_ in GAPS:
        found = [line for line in source.splitlines()
                 if line.startswith(f"| {identifier} ·")]
        if len(found) != 1:
            raise ValueError(f"UNKNOWN: missing or duplicate {identifier}")
        columns = [part.strip() for part in found[0].strip().strip("|").split("|")]
        if len(columns) != 5:
            raise ValueError(f"UNKNOWN: malformed {identifier}")
        result[identifier] = columns
    return result


def operational_evidence(_candidate: object = None) -> str:
    """Offline test outcomes cannot certify live consent, transport or runtime."""
    return UNKNOWN


@lru_cache(maxsize=None)
def run_node(suite: str, mode: str = "") -> str:
    """Run an existing synthetic Node contract, with a minimal environment."""
    allowed = {row[3] for row in GAPS}
    if suite not in allowed or (mode and (suite, mode) != (
        "test-factory-control-runtime.cjs", "failclosed"
    )):
        raise ValueError("UNKNOWN: unexpected test suite or mode")
    node = shutil.which("node")
    if not node:
        raise AssertionError("UNKNOWN: Node is required for executed evidence")
    with tempfile.TemporaryDirectory(prefix="autofactory-proto-325-") as home:
        environment = {
            "PATH": os.pathsep.join((os.path.dirname(node), "/usr/bin", "/bin")),
            "HOME": home,
            "CI": "true",
        }
        command = [node, str(ROOT / suite)] + ([mode] if mode else [])
        completed = subprocess.run(
            command, cwd=ROOT, env=environment, text=True,
            capture_output=True, check=False, timeout=90,
        )
    if completed.returncode:
        raise AssertionError(
            f"UNKNOWN: synthetic Node contract {suite} exited {completed.returncode}"
        )
    return completed.stdout


class BrechasAutofactory18Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: execute a real behavior contract for each of five rows."""
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        self.assertEqual(len(rows), 5)
        for identifier, source, prior, suite, success, _ in GAPS:
            with self.subTest(requirement=identifier):
                self.assertTrue((ROOT / source).is_file())
                self.assertTrue((ROOT / prior).is_file())
                self.assertTrue((ROOT / suite).is_file())
                self.assertIn(source, rows[identifier][3])
                self.assertIn(f"`{prior}`", rows[identifier][3])
                self.assertIn("Contraste #290", rows[identifier][3])
                self.assertIn(success, run_node(suite))
                self.assertEqual(operational_evidence(success), UNKNOWN)

    def test_falla_cerrado(self) -> None:
        """AC-02: reject invalid, revoked, ambiguous or stale inputs."""
        for identifier, _, _, suite, _, rejection in GAPS:
            with self.subTest(requirement=identifier):
                self.assertIn(rejection, run_node(suite))
        self.assertIn(
            "factory-control runtime lifecycle: ok",
            run_node("test-factory-control-runtime.cjs", "failclosed"),
        )
        matrix = MATRIX.read_text(encoding="utf-8")
        first = next(line for line in matrix.splitlines()
                     if line.startswith("| PROTO-18 ·"))
        for corrupt in (matrix.replace(first, ""), matrix + "\n" + first,
                        matrix.replace(first, "| PROTO-18 · invalid |")):
            with self.assertRaises(ValueError):
                matrix_rows(corrupt)
        for invalid in (None, {}, {"ci": "success"},
                        {"offline": True, "passed": True},
                        {"runtime": "claimed", "authorization": "claimed"}):
            self.assertEqual(operational_evidence(invalid), UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        """AC-03: no network, credentials, chat text or production fixtures."""
        source = Path(__file__).read_text(encoding="utf-8")
        self.assertIn("tempfile.TemporaryDirectory(", source)
        self.assertIn("env=environment", source)
        for identifier, _, _, suite, _, _ in GAPS:
            with self.subTest(requirement=identifier):
                printed = run_node(suite).lower()
                for forbidden in (
                    "authorization: bearer", "access_token", "session_cookie",
                    "conversation_id", "private chat text", "secret@example.com",
                    "credential-001", "api_key",
                ):
                    self.assertNotIn(forbidden, printed)
        self.assertNotIn("requests." + "get(", source)
        self.assertNotIn("urllib." + "request", source)
        self.assertNotIn("http." + "client", source)
        self.assertNotIn("process." + "env", source)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: a green offline contract leaves operational evidence UNKNOWN."""
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        self.assertEqual(set(rows), {gap[0] for gap in GAPS})
        for identifier, row in rows.items():
            with self.subTest(requirement=identifier):
                self.assertEqual(row[2], "NO_VERIFICABLE")
                self.assertIn("Estado operativo: UNKNOWN", row[3])
                self.assertEqual(operational_evidence(row), UNKNOWN)
                self.assertEqual(operational_evidence(run_node(
                    next(gap[3] for gap in GAPS if gap[0] == identifier)
                )), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
