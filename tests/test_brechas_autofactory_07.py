"""Issue #314: brechas DEC-D-054..058 con evidencia offline y UNKNOWN explícito.

Solo pruebas sintéticas. Los contratos documentados no acreditan integración,
backups, despliegues, revisiones históricas ni estados de producción.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs" / "matriz-cobertura.md"
DECISIONS = ROOT / "decisiones.yml"

# (fuente para contrastar, prueba previa citada, límite operativo a preservar)
GAPS = {
    "DEC-D-054": (
        "decisiones.yml", "tests/test_release_artifact_attestation.py",
        "migración de base de datos no aplica",
    ),
    "DEC-D-055": (
        "decisiones.yml", "tests/test_ci_salida_quality.py",
        "no habilita producción real",
    ),
    "DEC-D-056": (
        ".github/workflows/release.yml", "tests/test_release_artifact_attestation.py",
        "smoke real Chrome/Safari",
    ),
    "DEC-D-057": (
        ".github/workflows/coordinacion.yml", "tests/test_coordination_workflow_contract.py",
        "no se auditó en vivo cardinalidad",
    ),
    "DEC-D-058": (
        ".github/workflows/coordinacion.yml", "tests/test_coordination_workflow_contract.py",
        "no se acreditó ejecución profesional",
    ),
}


def extract_rows(document: str) -> dict[str, tuple[str, str, str, str]]:
    """No aceptar filas ausentes, repetidas, truncadas ni IDs ambiguos."""
    found = {}
    for line in document.splitlines():
        if not line.startswith("| DEC-D-05"):
            continue
        parts = [part.strip() for part in line.strip().strip("|").split("|")]
        if len(parts) != 5:
            raise ValueError("fila DEC inválida")
        key = parts[0].split(" · ", 1)[0]
        if key not in GAPS:
            continue
        if key in found or not parts[0].startswith(f"{key} · "):
            raise ValueError("ID DEC repetido o ambiguo")
        if not all(parts):
            raise ValueError("fila DEC incompleta")
        found[key] = tuple(parts[1:])
    if set(found) != set(GAPS):
        raise ValueError("faltan filas DEC obligatorias")
    return found


def resolve_offline_state(row: tuple[str, str, str, str] | None) -> str:
    """Una mención en matriz o CI estático jamás prueba integración real."""
    if not row or len(row) != 4:
        return "UNKNOWN"
    _, state, evidence, _ = row
    if state != "NO_VERIFICABLE" or "UNKNOWN" not in evidence:
        return "UNKNOWN"
    return "UNKNOWN"  # La reconciliación operativa corresponde a otra hoja.


def label_cardinality(labels: list[str] | None) -> bool:
    """Regla D-057 sobre un ejemplo sintético, no auditoría GitHub."""
    if not isinstance(labels, list) or not all(isinstance(x, str) for x in labels):
        return False
    return all(sum(x.startswith(prefix) for x in labels) == 1 for prefix in
               ("tipo: ", "prioridad: ", "estado: "))


def roles_declared_and_applied(required: set[str] | None,
                               declared: set[str] | None,
                               applied: set[str] | None) -> bool:
    """Regla D-058 en datos inventados; sin prueba de ejecución histórica."""
    if not all(isinstance(x, set) for x in (required, declared, applied)):
        return False
    if not required or any(not isinstance(x, str) or not x for x in required | declared | applied):
        return False
    return required <= declared and required <= applied


class BrechasAutofactory07Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rows = extract_rows(MATRIX.read_text(encoding="utf-8"))
        cls.decisions = json.loads(DECISIONS.read_text(encoding="utf-8"))["decisions"]

    def test_contrato_principal(self) -> None:
        decisions = {item["id"]: item for item in self.decisions}
        self.assertLessEqual(set(GAPS), {f"DEC-{key}" for key in decisions})
        for key, (source, prior_test, gap) in GAPS.items():
            with self.subTest(id=key):
                requirement, state, evidence, issue = self.rows[key]
                decision = decisions[key.removeprefix("DEC-")]
                self.assertEqual("active", decision["status"])
                self.assertIn(decision["text"], requirement)
                self.assertEqual("NO_VERIFICABLE", state)
                self.assertIn("Contraste #291", evidence)
                self.assertIn(f"{chr(96)}{source}{chr(96)}", evidence)
                self.assertIn(f"{chr(96)}{prior_test}{chr(96)}", evidence)
                self.assertIn(gap.casefold(), evidence.casefold())
                self.assertIn("UNKNOWN", evidence)
                self.assertTrue((ROOT / source).is_file(), source)
                self.assertTrue((ROOT / prior_test).is_file(), prior_test)
                self.assertEqual("[#1](https://github.com/pl0n3r/AutoFactory/issues/1)", issue)
                self.assertEqual("UNKNOWN", resolve_offline_state(self.rows[key]))

        # D-056: compuertas reales declaradas, no un smoke de entrega ejecutado.
        release = (ROOT / GAPS["DEC-D-056"][0]).read_text(encoding="utf-8")
        for stage in ("chrome_smoke:", "safari_smoke:", "needs: [preflight, chrome_smoke, safari_smoke]",
                      "scripts/package-release.py", "gh release create"):
            self.assertIn(stage, release)
        # D-057/D-058: casos sintéticos que muestran la semántica mínima de cada regla.
        labels = ["tipo: pruebas", "prioridad: media", "estado: reservado", "rol: qa"]
        self.assertTrue(label_cardinality(labels))
        self.assertFalse(label_cardinality(labels + ["estado: disponible"]))
        self.assertTrue(roles_declared_and_applied({"qa"}, {"qa", "ingenieria"}, {"qa"}))
        self.assertFalse(roles_declared_and_applied({"qa"}, {"qa"}, set()))

    def test_falla_cerrado(self) -> None:
        rows = self.rows
        self.assertEqual("UNKNOWN", resolve_offline_state(None))
        self.assertEqual("UNKNOWN", resolve_offline_state(()))
        self.assertEqual("UNKNOWN", resolve_offline_state(("dato", "CUBIERTO", "CI verde", "issue")))
        self.assertFalse(label_cardinality(None))
        self.assertFalse(label_cardinality(["tipo: pruebas", "prioridad: media"]))
        self.assertFalse(label_cardinality(["tipo: pruebas", "prioridad: media", "estado: reservado", "estado: reservado"]))
        self.assertFalse(roles_declared_and_applied(None, set(), set()))
        self.assertFalse(roles_declared_and_applied({"seguridad"}, {"qa"}, {"seguridad"}))
        source_lines = MATRIX.read_text(encoding="utf-8").splitlines()
        d054 = next(line for line in source_lines if line.startswith("| DEC-D-054 · "))
        full = "\n".join(source_lines)
        for corrupted in (full.replace(d054, ""), full + "\n" + d054,
                          full.replace(d054, "| DEC-D-054 · truncada |")):
            with self.subTest(corruption=corrupted.count("DEC-D-054")):
                with self.assertRaises(ValueError):
                    extract_rows(corrupted)
        self.assertEqual(set(rows), set(GAPS))

    def test_sin_datos_reales(self) -> None:
        # Ninguna fixture contiene datos de cuentas, chats, correos, secretos o endpoints.
        fixtures = {
            "labels": ["tipo: pruebas", "prioridad: media", "estado: reservado"],
            "roles": ["qa", "ingenieria"],
            "release": {"tag": "v0.0.0", "chrome_smoke": False, "safari_smoke": None},
            "migration": {"backup": None, "rollback": None},
        }
        encoded = json.dumps(fixtures, sort_keys=True)
        self.assertNotIn("@", encoded)
        self.assertNotIn("https://", encoded)
        self.assertNotRegex(encoded, r"(?i)(?:bearer\s+|sk-[a-z0-9]+|password\s*[:=])")
        self.assertEqual("UNKNOWN", resolve_offline_state(None))

    def test_estados_unknown_explicitos(self) -> None:
        for key in GAPS:
            with self.subTest(id=key):
                requirement, state, evidence, _ = self.rows[key]
                self.assertRegex(requirement, rf"\b{re.escape(key.removeprefix('DEC-'))}\b")
                self.assertEqual("NO_VERIFICABLE", state)
                self.assertRegex(evidence, r"(?i)(?:falta|no se|no aplica|no habilita)")
                self.assertRegex(evidence, r"Estado operativo: UNKNOWN")
                self.assertEqual("UNKNOWN", resolve_offline_state(self.rows[key]))
        # Incluso un artefacto o etiqueta sintética válida no acredita producción.
        self.assertTrue(label_cardinality(["tipo: pruebas", "prioridad: media", "estado: reservado"]))
        self.assertEqual("UNKNOWN", resolve_offline_state(self.rows["DEC-D-057"]))
        self.assertEqual("UNKNOWN", resolve_offline_state(self.rows["DEC-D-056"]))


if __name__ == "__main__":
    unittest.main()
