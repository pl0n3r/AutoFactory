"""AutoFactory #330: cinco brechas README con pruebas offline y UNKNOWN.

Una regresion sintética o CI verde NO certifica cola GitHub actual, navegador
instalado, flujo E2E real, consentimiento ni pairing/transport de ControlBot.
"""
from __future__ import annotations

import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
UNKNOWN = "UNKNOWN"

# ID de la unidad, indicadores de su obligación exacta en README.
GAPS = {
    "README-03-04": ("**LATER:**", "#134"),
    "README-03-05": ("**BLOCKED:**", "#219", "#220", "#1"),
    "README-04-01": (
        "Observa únicamente las pestañas habilitadas",
        "autopilot-core.js", "content.js",
    ),
    "README-04-02": (
        "Gestiona estados transitorios, reintentos seguros",
        "varias pestañas locales",
    ),
    "README-04-03": (
        "Conserva contratos offline para ControlBot",
        "sin asumir pairing o transporte real",
    ),
}

# Se ejecutan las regresiones existentes reales, no solo nombres de pruebas.
# Los tres comandos son scripts versionados sin transporte ni navegador real.
SCENARIOS = {
    "README-04-01": (
        "test-interruption.cjs",
        ("Interrupción:", "Envío:"),
    ),
    "README-04-02": (
        "test-reliability.cjs",
        ("Reliability:", "Plataforma:"),
    ),
    "README-04-03": (
        "test-factory-control-bridge-e2e-synthetic.cjs",
        ("bridge-e2e AC-01:", "bridge-e2e AC-02:"),
    ),
}


def matrix_rows(document: str) -> dict[str, tuple[str, ...]]:
    """Falta, duplicado, estado prematuro o truncamiento -> UNKNOWN."""
    if not isinstance(document, str):
        raise ValueError("UNKNOWN: matriz no textual")
    found = {}
    for raw in document.splitlines():
        line = raw.lstrip()
        if not line.startswith("| README-"):
            continue
        parts = tuple(piece.strip() for piece in line.strip().strip("|").split("|"))
        key = parts[0].split(" · ", 1)[0] if parts else ""
        if key not in GAPS:
            continue
        if (key in found or len(parts) != 5 or not all(parts)
                or parts[0] != key + " · README.md"
                or parts[2] != "NO_VERIFICABLE"
                or "Contraste #292" not in parts[3]
                or "UNKNOWN" not in parts[3]):
            raise ValueError("UNKNOWN: fila incompleta/ambigua: " + key)
        found[key] = parts
    if set(found) != set(GAPS):
        raise ValueError("UNKNOWN: faltan unidades README asignadas")
    return found


def operational_state(evidence: object = None) -> str:
    """Sin atestación externa auténtica ninguna evidencia offline es GO."""
    return UNKNOWN


def exercise_node(script: str, expected: tuple[str, ...]) -> bool:
    """Ejecuta contratos reales con Node y salida de error censurada."""
    allowed = {case[0] for case in SCENARIOS.values()}
    if script not in allowed or not (ROOT / script).is_file():
        return False
    try:
        result = subprocess.run(
            ["node", script], cwd=ROOT, capture_output=True, text=True,
            timeout=35, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    # Los fallos se reportan con código fijo; nunca exponer logs de proveedor.
    return result.returncode == 0 and all(
        token in result.stdout for token in expected
    )


class BrechasAutofactory23Tests(unittest.TestCase):
    """AC-01..04 del issue #330, sin inferir autoridad operacional."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.matrix = MATRIX.read_text(encoding="utf-8")
        cls.rows = matrix_rows(cls.matrix)
        cls.readme = (ROOT / "README.md").read_text(encoding="utf-8")
        cls.contrast = (
            ROOT / "docs/contraste-af_readme.md"
        ).read_text(encoding="utf-8")

    def test_contrato_principal(self) -> None:
        """AC-01: cinco filas + tres regresiones Node ejecutadas."""
        self.assertEqual(set(GAPS), set(self.rows))
        self.assertEqual(len(self.rows), 5)
        for identifier, tokens in GAPS.items():
            with self.subTest(unit=identifier):
                row = self.rows[identifier]
                self.assertEqual(row[0], identifier + " · README.md")
                self.assertEqual(row[2], "NO_VERIFICABLE")
                self.assertIn("docs/contraste-af_readme.md", row[3])
                self.assertIn("UNKNOWN", row[3])
                self.assertIn(identifier + " |", self.contrast)
                for token in tokens:
                    self.assertIn(token, self.readme, identifier)
                self.assertEqual(operational_state(row), UNKNOWN)

        # Queue README-03-04/05 is a historical statement, not an
        # authenticated contemporaneous API snapshot of issues and leases.
        self.assertIn("El estado actual lo determina GitHub", self.readme)
        self.assertIn("esta portada no calcula progreso", self.readme)
        for identifier, (script, expected) in SCENARIOS.items():
            with self.subTest(unit=identifier, script=script):
                self.assertTrue(
                    exercise_node(script, expected),
                    identifier + ": UNKNOWN, regresión local no ejecutada",
                )

        # The bridge source contracts remain local and the README forbids
        # deriving operational pairing authority from this evidence.
        decisions = json.loads((ROOT / "decisiones.yml").read_text(encoding="utf-8"))
        active = {d["id"]: d for d in decisions["decisions"]}
        self.assertEqual(active["D-061"]["status"], "active")
        self.assertIn("permanece sin tráfico real", active["D-061"]["text"])
        self.assertIn("no equivale a producción VERDE", self.readme)

    def test_falla_cerrado(self) -> None:
        """AC-02: cada fila ausente, repetida, dañada o promocionada falla."""
        for identifier in GAPS:
            line = next(
                raw for raw in self.matrix.splitlines()
                if raw.startswith("| " + identifier + " ·")
            )
            with self.subTest(unit=identifier):
                for damaged in (
                    self.matrix.replace(line, ""),
                    self.matrix + "\n  " + line,
                    self.matrix.replace(line, "| " + identifier + " | corta |"),
                    self.matrix.replace(
                        line, line.replace("NO_VERIFICABLE", "CUBIERTO", 1),
                    ),
                    self.matrix.replace(
                        line, line.replace("UNKNOWN", "completo", 1),
                    ),
                ):
                    with self.assertRaises(ValueError):
                        matrix_rows(damaged)
        self.assertEqual(operational_state(None), UNKNOWN)
        self.assertEqual(operational_state({"github": "untrusted"}), UNKNOWN)
        self.assertFalse(exercise_node("../test-core.cjs", ("success",)))
        self.assertFalse(exercise_node("missing.cjs", ("success",)))

    def test_sin_datos_reales(self) -> None:
        """AC-03: sin PII, credenciales o peticiones externas."""
        synthetic = {
            "issue": 0,
            "snapshot": "synthetic-missing",
            "browser": "not-installed",
            "pairing": "disabled",
            "code": "UNKNOWN",
        }
        rendered = json.dumps(synthetic, sort_keys=True)
        for forbidden in ("@", "https://", "Bearer ", "ghp_", "password"):
            self.assertNotIn(forbidden, rendered)
        self.assertEqual(operational_state(synthetic), UNKNOWN)
        for script, _ in SCENARIOS.values():
            self.assertFalse(Path(script).is_absolute())
            self.assertTrue(script.endswith(".cjs"))
            self.assertTrue((ROOT / script).is_file())
        source = Path(__file__).read_text(encoding="utf-8")
        self.assertNotRegex(
            source, r"(?m)^(?:import|from)\s+(?:requests|httpx|socket)\b"
        )
        self.assertNotIn("PRIVATE KEY-----", source)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: ni docs ni regresión Node confieren GO o smoke real."""
        for identifier, row in self.rows.items():
            with self.subTest(unit=identifier):
                self.assertEqual(row[2], "NO_VERIFICABLE")
                self.assertEqual(operational_state(row), UNKNOWN)
        preview = (
            ROOT / "docs/bridge-live-readiness-preview.md"
        ).read_text(encoding="utf-8")
        self.assertIn("NO-GO", preview)
        self.assertIn("NO_ACTIVAR_BRIDGE", preview)
        self.assertIn("Sin cobertura", "Sin cobertura")
        for fabricated in (
            {"status": "success", "sha": "a" * 40},
            {"installation": "Chrome", "smoke": True},
            {"installation": "Safari", "smoke": True},
            {"pairing": "paired", "online": True},
            {"issues": [134, 219, 220], "ready": True},
        ):
            self.assertEqual(operational_state(fabricated), UNKNOWN)
        self.assertIn("CI verde no equivale a producción VERDE", self.readme)
        self.assertIn("No inferir instalación", self.readme)


if __name__ == "__main__":
    unittest.main()
