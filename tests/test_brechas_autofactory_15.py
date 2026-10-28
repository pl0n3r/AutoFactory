#!/usr/bin/env python3
"""AutoFactory #322: evidencia sintética PROTO-03..07.

Los contratos offline no verifican consentimiento real, instancia conectada,
persistencia Chrome MV3, reversión instalada ni ControlBot en producción.
El estado operativo permanece UNKNOWN.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import os
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
UNKNOWN = "UNKNOWN"

# ID, JS, contraste anterior, suite Node, marcador principal y marcador negativo.
GAPS = (
    ("PROTO-03", "factory-control-authorization.js",
     "tests/test_factory_control_v2.py", "test-factory-control-ledger.cjs",
     "Factory Control v2 authorization and ledger: instance-scoped, expiring and idempotent",
     "AC-V2-04: Safari mirror and sanitized adapter errors"),
    ("PROTO-04", "factory-control-protocol.js",
     "tests/test_factory_control_v2.py", "test-factory-control.cjs",
     "Factory Control v2 protocol: exact, instance-scoped and data-minimized",
     "Factory Control protocol: heartbeat, command and ACK allowlists correct"),
    ("PROTO-05", "factory-control-ledger.js",
     "tests/test_factory_control_v2_ledger_persistence.py",
     "test-factory-control-ledger.cjs",
     "AC-V2-03: same-adapter concurrency serialized with documented boundary",
     "AC-V2-02: done failure keeps pending and blocks replay"),
    ("PROTO-06", "factory-control-chrome-storage.js",
     "tests/test_factory_control_v2_ledger_persistence.py",
     "test-factory-control-ledger.cjs",
     "Chrome receipt store: durable, duplicate-safe, fail-closed and data-minimized",
     "AC-V2-01: false and silent saves deny effects"),
    ("PROTO-07", "factory-control-authorization.js",
     "tests/test_factory_control_v2.py", "test-factory-control-ledger.cjs",
     "Factory Control v2 authorization and ledger: instance-scoped, expiring and idempotent",
     "AC-V2-01: false and silent saves deny effects"),
)
AUTH_SUITE = "test-factory-control-authorization.cjs"
AUTH_MARKER = "Factory Control authorization: opt-in, expiry, revocation, tab scope and fail closed"


def matrix_rows(document: str) -> dict[str, list[str]]:
    rows: dict[str, list[str]] = {}
    for identifier, *_ in GAPS:
        matches = [line for line in document.splitlines()
                   if line.startswith(f"| {identifier} ·")]
        if len(matches) != 1:
            raise ValueError(f"UNKNOWN: absent or duplicated {identifier}")
        fields = [field.strip() for field in matches[0].strip().strip("|").split("|")]
        if len(fields) != 5:
            raise ValueError(f"UNKNOWN: malformed row {identifier}")
        rows[identifier] = fields
    return rows


def operational_evidence(requirement: str, report: object = None) -> str:
    """Offline tests never grant permission for actual bridge execution."""
    return UNKNOWN


@lru_cache(maxsize=4)
def run_node(filename: str) -> str:
    allowed = {row[3] for row in GAPS} | {AUTH_SUITE}
    if filename not in allowed:
        raise ValueError("UNKNOWN: invalid synthetic suite")
    node = shutil.which("node")
    if not node:
        raise AssertionError("UNKNOWN: Node unavailable")
    process = subprocess.run(
        [node, str(ROOT / filename)], cwd=ROOT,
        capture_output=True, text=True, check=False, timeout=90,
        env={"PATH": os.pathsep.join((os.path.dirname(node), "/usr/bin", "/bin")),
             "CI": "true"},
    )
    if process.returncode != 0:
        raise AssertionError(f"UNKNOWN: offline suite {filename} exit {process.returncode}")
    return process.stdout


class BrechasAutofactory15Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: las cinco brechas ejecutan aserciones reales de JS."""
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        self.assertEqual(len(rows), 5)
        for identifier, source, prior, suite, marker, _ in GAPS:
            with self.subTest(gap=identifier):
                row = rows[identifier]
                self.assertTrue((ROOT / source).is_file())
                self.assertTrue((ROOT / prior).is_file())
                self.assertTrue((ROOT / suite).is_file())
                self.assertIn(source, row[3])
                self.assertIn(prior, row[3])
                self.assertIn("Contraste #290", row[3])
                self.assertIn(marker, run_node(suite))
        self.assertIn(AUTH_MARKER, run_node(AUTH_SUITE))

    def test_falla_cerrado(self) -> None:
        """AC-02: rechazos, ACK no-confirmado y reintentos ambiguos."""
        for identifier, _, _, suite, _, negative in GAPS:
            with self.subTest(gap=identifier):
                # Marker emitted after the Node suite asserts rejection.
                self.assertIn(negative, run_node(suite))
                self.assertEqual(operational_evidence(
                    identifier, {"scope": "offline", "passed": True}), UNKNOWN)
        self.assertIn(AUTH_MARKER, run_node(AUTH_SUITE))
        matrix = MATRIX.read_text(encoding="utf-8")
        row = next(line for line in matrix.splitlines()
                   if line.startswith("| PROTO-03 ·"))
        for invalid in (matrix.replace(row, ""), matrix + "\n" + row,
                        matrix.replace(row, "| PROTO-03 · broken |")):
            with self.assertRaises(ValueError):
                matrix_rows(invalid)

    def test_sin_datos_reales(self) -> None:
        """AC-03: solo módulos locales y stdout sanitizado."""
        for suite in {row[3] for row in GAPS} | {AUTH_SUITE}:
            output = run_node(suite).lower()
            for forbidden in (
                "private chat text", "private cookie", "access_token",
                "session_cookie", "conversation_id", "authorization: bearer",
                "secret@example.com", "api_key", "credential-001",
            ):
                with self.subTest(suite=suite, field=forbidden):
                    self.assertNotIn(forbidden, output)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: falta evidencia de consentimiento, runtime y persistencia real."""
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        self.assertEqual(set(rows), {row[0] for row in GAPS})
        for identifier, row in rows.items():
            with self.subTest(gap=identifier):
                self.assertEqual(row[2], "NO_VERIFICABLE")
                self.assertIn("Estado operativo: UNKNOWN", row[3])
                for candidate in (
                    None, {}, {"ci": "success"},
                    {"scope": "offline", "passed": True},
                    {"runtime": "claimed", "sha": "synthetic"},
                ):
                    self.assertEqual(
                        operational_evidence(identifier, candidate), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
