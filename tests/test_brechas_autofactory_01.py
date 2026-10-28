"""AutoFactory #308: evidencia offline para las brechas AF1-AC-01..05.

Los contratos Node usan adaptadores sintéticos: un resultado verde no es
prueba de pairing real, transporte remoto ni consentimiento productivo.
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

# (ID, JS real, test de contraste, suite Node, marcador positivo, marcador negativo, modo)
GAPS = (
    ("AF1-AC-01", "factory-control-pairing.js", "tests/test_factory_control_pairing_public_result.py",
     "test-factory-control-pairing.cjs", "pairing-public AC-01..04: ok",
     "pairing-audit AC-01: ok", ""),
    ("AF1-AC-02", "factory-control-heartbeat.js", "tests/test_factory_control_heartbeat_presence.py",
     "test-factory-control-heartbeat.cjs", "heartbeat-presence AC-01: ok",
     "heartbeat-presence AC-03: ok", ""),
    ("AF1-AC-03", "factory-control-executor.js", "tests/test_factory_control_executor_audit.py",
     "test-factory-control-executor.cjs",
     "Factory Control executor: authorization, durable idempotency, effect isolation and safe ACKs pass",
     "Factory Control audit AC-03: sanitized durable decisions", ""),
    ("AF1-AC-04", "factory-control-account-state.js", "tests/test_factory_control_account_state.py",
     "test-factory-control-account-state.cjs", "account-state AC-01: ok",
     "account-state AC-03: ok", ""),
    ("AF1-AC-05", "factory-control-runtime.js", "tests/test_factory_control_runtime.py",
     "test-factory-control-runtime.cjs", "factory-control runtime lifecycle: ok",
     "factory-control runtime lifecycle: ok", "failclosed"),
)


def matrix_row(identifier: str) -> str | None:
    if not MATRIX.is_file():
        return None
    rows = [line for line in MATRIX.read_text(encoding="utf-8").splitlines()
            if line.startswith(f"| {identifier} · AutoFactory#1 |")]
    return rows[0] if len(rows) == 1 else None


def state_for_offline_evidence(report: object) -> str:
    """Un resultado offline, ausente o ambiguo nunca acredita el puente vivo."""
    if not isinstance(report, dict):
        return "UNKNOWN"
    if report.get("scope") != "offline" or report.get("passed") is not True:
        return "UNKNOWN"
    return "UNKNOWN"  # OWNER #242/B y D-061 siguen prohibiendo integración real.


@lru_cache(maxsize=6)
def run_synthetic_suite(filename: str, mode: str = "") -> str:
    assert filename in {row[3] for row in GAPS}
    node = shutil.which("node")
    if not node:
        raise AssertionError("UNKNOWN: Node ausente; no atribuir cobertura")
    safe_path = ":".join(filter(None, (
        os.path.dirname(node), "/usr/local/bin", "/usr/bin", "/bin"
    )))
    result = subprocess.run(
        [node, str(ROOT / filename), *([mode] if mode else [])],
        cwd=ROOT, env={"PATH": safe_path, "FACTORY_PAIRING_PYTHON_CHILD": "1"},
        capture_output=True, text=True, check=False, timeout=90,
    )
    if result.returncode != 0:
        raise AssertionError(f"UNKNOWN: contrato sintético {filename} falló (exit {result.returncode})")
    return result.stdout


class BrechasAutofactory01Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AF1-AC-01..05: aserciones ejecutan JS real, no solo buscan ficheros."""
        for identifier, source, previous, suite, positive, _, _ in GAPS:
            with self.subTest(gap=identifier):
                row = matrix_row(identifier)
                self.assertIsNotNone(row, f"UNKNOWN: falta o se duplica {identifier}")
                self.assertIn("NO_VERIFICABLE", row)
                self.assertIn("Contraste #290", row)
                self.assertIn(f"`{source}`", row)
                self.assertIn(f"`{previous}`", row)
                self.assertTrue((ROOT / source).is_file())
                self.assertTrue((ROOT / previous).is_file())
                self.assertTrue((ROOT / suite).is_file())
                self.assertIn(positive, run_synthetic_suite(suite))

    def test_falla_cerrado(self) -> None:
        """Los cinco JS ejercitan negativas sintéticas, sin elevar su estado."""
        for identifier, _, _, suite, _, negative, mode in GAPS:
            with self.subTest(gap=identifier):
                self.assertIn(negative, run_synthetic_suite(suite, mode))
                self.assertEqual(
                    state_for_offline_evidence({"scope": "offline", "passed": True}),
                    "UNKNOWN", identifier,
                )
        for invalid in (None, {}, [], {"passed": True},
                        {"scope": "offline", "passed": "true"},
                        {"scope": "live", "passed": True}):
            with self.subTest(invalid=invalid):
                self.assertEqual(state_for_offline_evidence(invalid), "UNKNOWN")

    def test_sin_datos_reales(self) -> None:
        """No se usan cuentas externas ni se emiten cadenas privadas en stdout."""
        for identifier, _, _, suite, _, _, _ in GAPS:
            with self.subTest(gap=identifier):
                output = run_synthetic_suite(suite).lower()
                for synthetic_private_value in (
                    "private chat text", "private-token", "secret@example.com",
                    "credential-001", "token=never-reflect",
                ):
                    self.assertNotIn(synthetic_private_value, output)

    def test_estados_unknown_explicitos(self) -> None:
        """Las cinco filas NO_VERIFICABLE permanecen UNKNOWN hasta gate real."""
        self.assertEqual(len({gap[0] for gap in GAPS}), 5)
        for identifier, *_ in GAPS:
            with self.subTest(gap=identifier):
                row = matrix_row(identifier)
                self.assertIsNotNone(row)
                self.assertIn("Estado operativo: UNKNOWN", row)
                self.assertIn("NO_VERIFICABLE", row)
                self.assertEqual(state_for_offline_evidence({
                    "scope": "offline", "passed": True, "gap": identifier,
                }), "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
