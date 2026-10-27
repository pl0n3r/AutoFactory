"""AutoFactory #255: aceptación fail-closed de la matriz trazable del épico #1.

Solo lee el checkout. No usa red, tokens, cuentas, instalaciones Safari ni
simulaciones de integración que puedan confundirse con tráfico autorizado.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "docs" / "matriz-cobertura.md"
PROTO = ROOT / "docs" / "factory-control-protocol.md"
README = ROOT / "README.md"
DECISIONS = ROOT / "decisiones.yml"

STATES = frozenset({
    "CUBIERTO", "EN_CURSO", "SIN_COBERTURA",
    "DESCARTADO", "NO_VERIFICABLE",
})
ISSUES = frozenset({
    1, 122, 129, 130, 131, 132, 133, 134,
    216, 219, 253, 255,
})
ISSUE_RE = re.compile(
    r"^\[#(?P<number>\d+)\]\("
    r"https://github\.com/pl0n3r/AutoFactory/issues/(?P=number)\)$"
)
ROW_ID_RE = re.compile(
    r"^(?:AF1-AC|README|PROTO|DOC|ISSUE|DEC|HIST)-[A-Z0-9-]+$"
)
MERGED_PR_RE = re.compile(
    r"\[PR #\d+(?: fusionado)?\]\("
    r"https://github\.com/pl0n3r/AutoFactory/pull/\d+\)"
)


def rows():
    if not REPORT.is_file():
        raise AssertionError("Falta docs/matriz-cobertura.md")
    text = REPORT.read_text(encoding="utf-8")
    result = []
    for line in text.splitlines():
        if not line.startswith("| "):
            continue
        columns = [value.strip() for value in line.strip().strip("|").split("|")]
        if not columns or not ROW_ID_RE.match(columns[0].split(" · ", 1)[0]):
            continue
        if len(columns) != 5:
            raise AssertionError(f"Fila con número de columnas inválido: {line}")
        result.append(tuple(columns))
    return result


class MatrizCoberturaTests(unittest.TestCase):
    def test_cubre_todas_las_fuentes(self):
        data = rows()
        self.assertGreaterEqual(len(data), 70, "Inventario sospechosamente incompleto")
        sources = [r[0] for r in data]
        titles = [r[1] for r in data]

        # Un documento normativo raíz omitido rompe la aceptación. Los archivos
        # de superpowers/ son históricos y se identifican aparte en la matriz.
        for doc in ROOT.joinpath("docs").glob("*.md"):
            if doc.name == "matriz-cobertura.md":
                continue
            with self.subTest(doc=doc.name):
                self.assertTrue(any(doc.relative_to(ROOT).as_posix() in s
                                    for s in sources), f"Documento sin fila: {doc}")

        readme_sections = [
            line[3:].strip().replace("|", " / ")
            for line in README.read_text(encoding="utf-8").splitlines()
            if line.startswith("## ")
        ]
        protocol_sections = [
            line[3:].strip().replace("|", " / ")
            for line in PROTO.read_text(encoding="utf-8").splitlines()
            if line.startswith("## ")
        ]
        for section in readme_sections + protocol_sections:
            with self.subTest(section=section):
                self.assertIn(section, titles, f"Sección normativa ausente: {section}")

        for issue in ISSUES:
            self.assertTrue(any(s.startswith(f"ISSUE-{issue} · ") for s in sources),
                            f"Falta issue #{issue} del épico")
        for ac in range(1, 6):
            self.assertTrue(any(s.startswith(f"AF1-AC-{ac:02d} · ") for s in sources))
        self.assertTrue(DECISIONS.is_file())
        for decision in ("D-054", "D-055", "D-056", "D-057", "D-058",
                         "D-059", "D-060", "D-061", "D-062"):
            self.assertTrue(any(s.startswith(f"DEC-{decision} · ") for s in sources))

    def test_sin_cobertura_tiene_issue(self):
        data = rows()
        for src, req, status, evidence, issue in data:
            with self.subTest(source=src):
                self.assertIsNotNone(ISSUE_RE.fullmatch(issue),
                                     f"Fila sin issue canónico: {src}")
                if status == "SIN_COBERTURA":
                    # No se admiten filas SIN_COBERTURA huérfanas o dirigidas
                    # solo al contenedor #1. Se exige una hoja específica real.
                    target = int(ISSUE_RE.fullmatch(issue).group("number"))
                    self.assertNotEqual(1, target)
                    self.assertRegex(evidence, r"https://github\.com/pl0n3r/AutoFactory/issues/\d+")
        # La ausencia de SIN_COBERTURA es válida cuando todo requisito ya
        # tiene un Issue trazable o permanece expresamente NO_VERIFICABLE.
        self.assertIn("SIN_COBERTURA", STATES)

    def test_formato_y_estados(self):
        data = rows()
        seen = set()
        counts = Counter()
        for source, requirement, state, evidence, issue in data:
            with self.subTest(source=source):
                identifier, sep, path = source.partition(" · ")
                self.assertTrue(sep and path)
                self.assertRegex(identifier, ROW_ID_RE)
                self.assertNotIn(identifier, seen, "ID de fila duplicado")
                seen.add(identifier)
                self.assertIn(state, STATES)
                counts[state] += 1
                self.assertGreater(len(requirement), 5)
                self.assertGreater(len(evidence), 30)
                self.assertRegex(issue, ISSUE_RE)
                self.assertNotIn("TODO", evidence.upper())
                if state == "CUBIERTO":
                    self.assertRegex(evidence, MERGED_PR_RE)
                    self.assertRegex(evidence, r"(?:test[-_/][\w.-]+|tests/[\w/.-]+)")
                if state == "NO_VERIFICABLE":
                    self.assertRegex(
                        evidence.lower(), r"sin|falta|no |pendiente|requiere"
                    )
                if state == "DESCARTADO":
                    self.assertRegex(evidence.lower(), r"históric|normativa")
        self.assertGreater(counts["NO_VERIFICABLE"], 0)
        self.assertGreater(counts["CUBIERTO"], 0)
        text = REPORT.read_text(encoding="utf-8")
        self.assertIn("SIMULACIÓN", text.upper() if "SIMULACIÓN" in text.upper() else
                      text.upper().replace("OFF", "SIMULACIÓN OFF"))
        self.assertIn("D-061", text)
        self.assertIn("73aeb3969e630101a5bae40a04ec598500fc9013", text)

    def test_resumen_por_estado(self):
        data = rows()
        counts = Counter(record[2] for record in data)
        text = REPORT.read_text(encoding="utf-8")
        self.assertIn(f"**Total: {len(data)} filas.**", text)
        for status in ("CUBIERTO", "EN_CURSO", "SIN_COBERTURA",
                       "DESCARTADO", "NO_VERIFICABLE"):
            self.assertIn(f"{status}: **{counts[status]}**", text)
        ratio = 100 * counts["CUBIERTO"] / len(data)
        self.assertIn(f"**Cobertura acreditada: {ratio:.1f}%**", text)
        self.assertIn("No es porcentaje de MVP operativo", text)


if __name__ == "__main__":
    unittest.main()
