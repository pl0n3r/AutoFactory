"""AutoFactory #257: matriz de cobertura por requisito, sin cobertura ficticia.

Pruebas de solo lectura, deterministas, sin red, tokens ni entorno Safari.
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
AGENTES = ROOT / "AGENTES.md"
DECISIONS = ROOT / "decisiones.yml"

STATES = frozenset({
    "CUBIERTO", "EN_CURSO", "SIN_COBERTURA",
    "DESCARTADO", "NO_VERIFICABLE",
})
# Solo los issues verificables y ejecutables de este corte pueden figurar
# EN_CURSO sin citar un PR ABIERTO. No incluye épicos, roadmaps o bloqueados.
EXECUTABLE_LEAVES_AT_CUT = frozenset({257, 258})
NON_EXECUTABLE_ISSUES = frozenset({
    1, 122, 129, 130, 131, 132, 133, 134, 216, 219, 253, 255,
})
ISSUES = frozenset({
    1, 122, 129, 130, 131, 132, 133, 134,
    216, 219, 253, 255, 257, 258,
})
ISSUE_RE = re.compile(
    r"^\[#(?P<number>\d+)\]\("
    r"https://github\.com/pl0n3r/AutoFactory/issues/(?P=number)\)$"
)
ROW_ID_RE = re.compile(
    r"^(?:AF1-AC|README|AGENTES|PROTO|DOC|ISSUE|DEC|HIST)-[A-Z0-9-]+$"
)
MERGED_PR_RE = re.compile(
    r"\[PR #\d+(?: fusionado)?\]\("
    r"https://github\.com/pl0n3r/AutoFactory/pull/\d+\)"
)
OPEN_PR_RE = re.compile(
    r"PR #\d+ abierto.*https://github\.com/pl0n3r/AutoFactory/pull/\d+"
)


def rows():
    if not REPORT.is_file():
        raise AssertionError("Falta docs/matriz-cobertura.md")
    result = []
    for line in REPORT.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| "):
            continue
        columns = [s.strip() for s in line.strip().strip("|").split("|")]
        if not columns or not ROW_ID_RE.match(columns[0].split(" · ", 1)[0]):
            continue
        if len(columns) != 5:
            raise AssertionError(f"Fila inválida: {line}")
        result.append(tuple(columns))
    return result


def section_titles(path):
    return [
        line[3:].strip().replace("|", " / ")
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.startswith("## ")
    ]


def en_curso_es_ejecutable(issue, evidence):
    """No convertir un contenedor/roadmap en progreso mediante un enlace."""
    if issue in NON_EXECUTABLE_ISSUES:
        return False
    if issue in EXECUTABLE_LEAVES_AT_CUT:
        return "factory-plan-task" in evidence
    return bool(OPEN_PR_RE.search(evidence))


class MatrizCoberturaTests(unittest.TestCase):
    def test_cubre_todo_el_alcance(self):
        data = rows()
        self.assertGreaterEqual(len(data), 100)
        sources = [r[0] for r in data]
        titles = [r[1] for r in data]

        for doc in (ROOT / "docs").glob("*.md"):
            if doc.name == "matriz-cobertura.md":
                continue
            with self.subTest(doc=doc.name):
                self.assertTrue(
                    any(doc.relative_to(ROOT).as_posix() in src for src in sources),
                    f"Documento sin fila: {doc}"
                )
        for file, prefix in ((README, "README-"), (AGENTES, "AGENTES-")):
            for title in section_titles(file):
                with self.subTest(file=file.name, section=title):
                    matches = [
                        r for r in data
                        if r[0].startswith(prefix)
                        and r[1].startswith(title + " — ")
                    ]
                    self.assertTrue(matches, f"Sin requisitos de {file.name}: {title}")
                    self.assertTrue(all(r[1] != title for r in matches))
        self.assertGreaterEqual(sum(r[0].startswith("AGENTES-") for r in data), 8)
        for section in section_titles(PROTO):
            with self.subTest(protocol_section=section):
                self.assertIn(section, titles)
        for issue in ISSUES:
            with self.subTest(issue=issue):
                self.assertTrue(
                    any(s.startswith(f"ISSUE-{issue} · ") for s in sources),
                    f"Sin fila del issue #{issue}"
                )
        for ac in range(1, 6):
            self.assertTrue(any(s.startswith(f"AF1-AC-{ac:02d} · ") for s in sources))
        self.assertTrue(DECISIONS.is_file())
        for decision in ("D-054", "D-055", "D-056", "D-057", "D-058",
                         "D-059", "D-060", "D-061", "D-062"):
            self.assertTrue(any(s.startswith(f"DEC-{decision} · ") for s in sources))

    def test_sin_cobertura_tiene_issue(self):
        for source, requirement, status, evidence, issue in rows():
            with self.subTest(source=source):
                match = ISSUE_RE.fullmatch(issue)
                self.assertIsNotNone(match, f"Falta issue canónico: {source}")
                if status == "SIN_COBERTURA":
                    self.assertNotEqual(1, int(match.group("number")))
                    self.assertIn("factory-plan-task", evidence)
                    self.assertRegex(
                        evidence, r"https://github\.com/pl0n3r/AutoFactory/issues/\d+"
                    )

    def test_formato_y_estados(self):
        seen = set()
        counts = Counter()
        for source, requirement, status, evidence, issue in rows():
            with self.subTest(source=source):
                identifier, sep, path = source.partition(" · ")
                self.assertTrue(sep and path)
                self.assertRegex(identifier, ROW_ID_RE)
                self.assertNotIn(identifier, seen, "ID repetido")
                seen.add(identifier)
                self.assertIn(status, STATES)
                counts[status] += 1
                self.assertGreater(len(requirement), 5)
                self.assertGreater(len(evidence), 30)
                match = ISSUE_RE.fullmatch(issue)
                self.assertIsNotNone(match)
                self.assertNotIn("TODO", evidence.upper())
                if status == "EN_CURSO":
                    self.assertTrue(
                        en_curso_es_ejecutable(int(match.group("number")), evidence),
                        f"EN_CURSO sin hoja ejecutable ni PR abierto: {source}"
                    )
                if status == "CUBIERTO":
                    self.assertRegex(evidence, MERGED_PR_RE)
                    self.assertRegex(evidence, r"(?:test[-_/][\w.-]+|tests/[\w/.-]+)")
                    self.assertRegex(evidence, r"(?:\x60[\w/.-]+\x60|\b[\w-]+\.js\b)")
                if status == "NO_VERIFICABLE":
                    self.assertRegex(
                        evidence.lower(), r"sin|falta|no |pendiente|requiere"
                    )
                if status == "DESCARTADO":
                    self.assertRegex(evidence.lower(), r"históric|normativa")
        self.assertGreater(counts["NO_VERIFICABLE"], 0)
        self.assertGreater(counts["CUBIERTO"], 0)
        text = REPORT.read_text(encoding="utf-8")
        self.assertIn("D-061", text)
        self.assertIn("73aeb3969e630101a5bae40a04ec598500fc9013", text)
        self.assertIn("86360fa53bd8a25dd2b02c2f4632bb82301841a4", text)

    def test_rechaza_epics_y_roadmaps_como_en_curso(self):
        for issue in NON_EXECUTABLE_ISSUES:
            with self.subTest(issue=issue):
                self.assertFalse(
                    en_curso_es_ejecutable(
                        issue, "factory-plan-task PR #999 abierto "
                        "https://github.com/pl0n3r/AutoFactory/pull/999"
                    )
                )
        self.assertFalse(en_curso_es_ejecutable(257, "solo épico/planificación"))
        self.assertFalse(en_curso_es_ejecutable(999, "PR #999 fusionado"))
        self.assertTrue(en_curso_es_ejecutable(257, "factory-plan-task; V3 vigente"))

    def test_resumen_final(self):
        data = rows()
        counts = Counter(r[2] for r in data)
        text = REPORT.read_text(encoding="utf-8")
        self.assertIn(f"**Total: {len(data)} filas.**", text)
        for status in ("CUBIERTO", "EN_CURSO", "SIN_COBERTURA",
                       "DESCARTADO", "NO_VERIFICABLE"):
            self.assertIn(f"{status}: **{counts[status]}**", text)
        ratio = 100 * counts["CUBIERTO"] / len(data)
        self.assertIn(f"**Cobertura acreditada: {ratio:.1f}%**", text)
        newly_created = {
            int(ISSUE_RE.fullmatch(r[4]).group("number"))
            for r in data if r[2] == "SIN_COBERTURA"
        }
        self.assertIn(f"**Hojas nuevas creadas: {len(newly_created)}.**", text)
        self.assertIn("No es porcentaje de MVP operativo", text)


if __name__ == "__main__":
    unittest.main()
