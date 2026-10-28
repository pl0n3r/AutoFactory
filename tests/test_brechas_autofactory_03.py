"""AutoFactory #310: cinco brechas AGENTES, con evidencia local no operativa.

Pruebas de solo lectura, deterministas y offline. LOCAL_ONLY nunca acredita
integración, inventario global, entrega instalable ni operación en live.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
AGENTS = ROOT / "AGENTES.md"
COORDINATION = ROOT / ".github/workflows/coordinacion.yml"
RUNTIME = ROOT / "factory-control-runtime.js"
DATA = ROOT / "datos.yml"

REQUIREMENTS = {
    "AGENTES-01-06": ("datos.yml", "tests/test_factory_control_readiness_report.py"),
    "AGENTES-01-07": ("factory-control-runtime.js", "tests/test_factory_control_runtime.py"),
    "AGENTES-01-08": (".github/workflows/coordinacion.yml", "tests/test_coordination_workflow_contract.py"),
    "AGENTES-01-09": (".github/workflows/coordinacion.yml", "tests/test_coordination_workflow_contract.py"),
    "AGENTES-01-10": (".github/workflows/coordinacion.yml", "tests/test_coordination_workflow_contract.py"),
}
UNKNOWN = "UNKNOWN"
LOCAL_ONLY = "LOCAL_ONLY"
LABEL_PREFIXES = ("tipo:", "prioridad:", "estado:")


def matrix_rows(raw: str) -> dict[str, tuple[str, ...]]:
    """Un ID ausente o duplicado no constituye una prueba verificable."""
    rows = {}
    for line in raw.splitlines():
        if not line.startswith("| "):
            continue
        columns = tuple(part.strip() for part in line.strip().strip("|").split("|"))
        if len(columns) != 5:
            continue
        key = columns[0].split(" · ", 1)[0]
        if key not in REQUIREMENTS:
            continue
        if key in rows:
            raise ValueError(f"Fila ambigua: {key}")
        rows[key] = columns
    return rows


def label_contract(labels: object) -> str:
    """Un inventario sintético válido prueba esquema, NO audita GitHub."""
    if type(labels) not in (list, tuple) or not labels:
        return UNKNOWN
    if any(type(item) is not str or not item.strip() for item in labels):
        return UNKNOWN
    if len(labels) != len(set(labels)):
        return UNKNOWN
    for prefix in LABEL_PREFIXES:
        matches = [item for item in labels if item.startswith(prefix)]
        if len(matches) != 1 or not matches[0][len(prefix):].strip():
            return UNKNOWN
    roles = [item for item in labels if item.startswith("rol:")]
    if not roles or any(not item[4:].strip() for item in roles):
        return UNKNOWN
    return LOCAL_ONLY


def branch_contract(name: object) -> str:
    """La rama presente no prueba el historial completo de ramas del repo."""
    if type(name) is not str or re.fullmatch(r"trabajo/issue-[1-9][0-9]*", name) is None:
        return UNKNOWN
    return LOCAL_ONLY


def phase_contract(phase: object, consent: object) -> str:
    """Declaración de construcción, nunca prueba de runtime emparejado."""
    if phase != "construccion" or consent != "required_before_activation":
        return UNKNOWN
    return LOCAL_ONLY


class BrechasAutofactory03Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: cinco filas, fuentes reales y alcance local explícito."""
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        self.assertEqual(set(REQUIREMENTS), set(rows))
        agents = AGENTS.read_text(encoding="utf-8")
        coordination = COORDINATION.read_text(encoding="utf-8")
        runtime = RUNTIME.read_text(encoding="utf-8")
        data = json.loads(DATA.read_text(encoding="utf-8"))
        with self.subTest(row="AGENTES-01-06"):
            self.assertIn("**Fase:** `construccion`", agents)
            self.assertEqual(LOCAL_ONLY, phase_contract(
                data.get("phase"), "required_before_activation"
                if any(t.get("consent") == "required_before_activation"
                       for t in data.get("treatments", [])) else None))
        with self.subTest(row="AGENTES-01-07"):
            self.assertIn("contratos aislados hasta integrarlos", agents)
            self.assertIn("function", runtime)
            self.assertIn("module.exports", runtime)
            self.assertNotIn("fetch(", runtime)
        with self.subTest(row="AGENTES-01-08"):
            self.assertIn("**Etiquetas:** `tipo:`, `prioridad:`, `estado:`, `rol:`", agents)
            self.assertIn("uses: pl0n3r/factory/.github/workflows/coordinacion.yml@v1", coordination)
        with self.subTest(row="AGENTES-01-09"):
            self.assertIn("Un tipo, una prioridad y un estado por Issue y PR", agents)
            self.assertIn("operation: validate", coordination)
        with self.subTest(row="AGENTES-01-10"):
            self.assertIn("**Ramas:** `trabajo/issue-N`", agents)
            self.assertIn("github.event.pull_request.head.ref", coordination)
        for key, (artifact, preexisting_test) in REQUIREMENTS.items():
            with self.subTest(artifact=key):
                self.assertTrue((ROOT / artifact).is_file())
                self.assertTrue((ROOT / preexisting_test).is_file())
                self.assertEqual("NO_VERIFICABLE", rows[key][2])
                self.assertIn(artifact, rows[key][3])
                self.assertIn(preexisting_test, rows[key][3])

    def test_falla_cerrado(self) -> None:
        """AC-02: la omisión y la cardinalidad ambigua nunca son éxito."""
        for labels in (None, [], {}, ["tipo: prueba"],
                       ["tipo: prueba", "tipo: mejora", "prioridad: media", "estado: disponible", "rol: qa"],
                       ["tipo: prueba", "prioridad: media", "estado: ", "rol: qa"],
                       ["tipo: prueba", "prioridad: media", "estado: disponible", "rol: qa", "rol: qa"]):
            with self.subTest(labels=labels):
                self.assertEqual(UNKNOWN, label_contract(labels))
        for branch in (None, "", "main", "trabajo/issue-0", "trabajo/issue-01",
                       "trabajo/issue-x", "feature/310", "trabajo/issue-310/extra"):
            with self.subTest(branch=branch):
                self.assertEqual(UNKNOWN, branch_contract(branch))
        for phase, consent in ((None, None), ("live", "required_before_activation"),
                               ("construccion", None), ("construccion", "review_required")):
            self.assertEqual(UNKNOWN, phase_contract(phase, consent))
        self.assertEqual({}, matrix_rows(""))
        repeated = "| AGENTES-01-06 · AGENTES.md | texto | NO_VERIFICABLE | UNKNOWN | #219 |"
        with self.assertRaisesRegex(ValueError, "ambigua"):
            matrix_rows(repeated + "\n" + repeated)

    def test_sin_datos_reales(self) -> None:
        """AC-03: únicamente paths y valores sintéticos, sin red ni credenciales."""
        self.assertEqual(LOCAL_ONLY, branch_contract("trabajo/issue-310"))
        self.assertEqual(LOCAL_ONLY, label_contract([
            "tipo: pruebas", "prioridad: media", "estado: disponible", "rol: qa",
        ]))
        tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
        modules = {alias.name for node in ast.walk(tree)
                   if isinstance(node, ast.Import) for alias in node.names}
        modules |= {node.module for node in ast.walk(tree)
                    if isinstance(node, ast.ImportFrom)}
        self.assertEqual({"__future__", "ast", "json", "pathlib", "re", "unittest"}, modules)
        self.assertIn("NO_VERIFICABLE", MATRIX.read_text(encoding="utf-8"))

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: cada brecha conserva UNKNOWN operativo aun con contratos locales."""
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        for key in REQUIREMENTS:
            with self.subTest(row=key):
                self.assertIn("UNKNOWN", rows[key][3])
                self.assertIn("falta", rows[key][3].lower())
                self.assertEqual("NO_VERIFICABLE", rows[key][2])
        self.assertEqual(LOCAL_ONLY, phase_contract("construccion", "required_before_activation"))
        self.assertEqual(LOCAL_ONLY, label_contract([
            "tipo: pruebas", "prioridad: media", "estado: disponible", "rol: ingenieria-software", "rol: qa",
        ]))
        self.assertEqual(LOCAL_ONLY, branch_contract("trabajo/issue-310"))
        self.assertNotEqual("CUBIERTO", LOCAL_ONLY)
        self.assertNotEqual("VALIDATED_IN_PRODUCTION", LOCAL_ONLY)


if __name__ == "__main__":
    unittest.main()
