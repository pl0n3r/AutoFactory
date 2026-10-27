"""AutoFactory #290: contraste exacto y sin inferencias de activación del puente."""
from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/contraste-af_proto.md"
MATRIX = ROOT / "docs/matriz-cobertura.md"
PREFIX = ("PROTO-", "DOC-", "AF1-AC-")
SELF = "DOC-CONTRASTE-AF-PROTO-01"
ARTIFACT = re.compile(r"`([^`]+)`; `([^`]+)`")
MERGED = re.compile(r"https://github\\.com/pl0n3r/AutoFactory/pull/\\d+.*fusionad", re.I)
LEAF = re.compile(r"https://github\\.com/pl0n3r/AutoFactory/issues/\\d+")


def matrix_rows(contents: str) -> dict[str, list[str]]:
    result = {}
    for line in contents.splitlines():
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 5:
            continue
        key = cells[0].split(" · ", 1)[0]
        if not key.startswith(PREFIX):
            continue
        if key in result:
            raise ValueError("ID duplicado de matriz: " + key)
        result[key] = cells
    return result


def report_rows(contents: str) -> dict[str, list[str]]:
    if contents.count("## Veredictos por fila") != 1 or contents.count("## Límites y continuación") != 1:
        raise ValueError("Secciones duplicadas o ausentes")
    part = contents.split("## Veredictos por fila", 1)[1].split("## Límites y continuación", 1)[0]
    result = {}
    for line in part.splitlines():
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 5 or not re.fullmatch(r"(?:PROTO-\\d{2}|DOC-[A-Z0-9-]+|AF1-AC-\\d{2})", cells[0]):
            continue
        if cells[0] in result:
            raise ValueError("Veredicto repetido")
        if cells[3] not in {"NO_VERIFICABLE", "CUBIERTO", "SIN_COBERTURA", "DESCARTADO", "NO_APLICA"}:
            raise ValueError("Estado inválido")
        if len(cells[4]) < 36 or not ARTIFACT.fullmatch(cells[2]):
            raise ValueError("Evidencia o límite incompleto")
        result[cells[0]] = cells
    return result


def verify(report: dict[str, list[str]], matrix: dict[str, list[str]]) -> None:
    for key, row in report.items():
        if key not in matrix or matrix[key][2] != row[3]:
            raise ValueError("Matriz y contraste divergen: " + key)
        match = ARTIFACT.fullmatch(row[2])
        if match is None:
            raise ValueError("Se requiere archivo y prueba")
        code, test = match.groups()
        if not (ROOT / code).is_file() or not (ROOT / test).is_file() or not test.startswith("tests/test_"):
            raise ValueError("Código o prueba no existe: " + key)
        if row[3] == "CUBIERTO" and not MERGED.search(row[4]):
            raise ValueError("CUBIERTO requiere PR fusionado autenticado")
        if row[3] == "SIN_COBERTURA" and (
            "factory-plan-task" not in row[4] or not LEAF.search(row[4])
        ):
            raise ValueError("SIN_COBERTURA requiere Issue hoja canónica")
        if row[3] == "NO_VERIFICABLE" and not re.search(r"falta|faltan|no se|no existe|no hay|no está", row[4].lower()):
            raise ValueError("NO_VERIFICABLE sin límite explícito")
        if "Contraste #290:" not in matrix[key][3] or code not in matrix[key][3] or test not in matrix[key][3]:
            raise ValueError("Matriz no actualizada: " + key)


class ContrasteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC.read_text(encoding="utf-8")
        cls.matrix_text = MATRIX.read_text(encoding="utf-8")
        cls.report = report_rows(cls.doc)
        cls.matrix = matrix_rows(cls.matrix_text)

    def test_cada_fila_tiene_veredicto(self) -> None:
        expected = {key for key, row in self.matrix.items()
                    if key.startswith(PREFIX) and row[2] == "NO_VERIFICABLE"}
        self.assertEqual(54, len(expected))
        self.assertEqual(expected, set(self.report))
        self.assertEqual(Counter(row[0].split("-", 1)[0] for row in self.report.values()),
                         Counter({"PROTO": 31, "DOC": 18, "AF1": 5}))
        self.assertTrue(all(row[3] == "NO_VERIFICABLE" for row in self.report.values()))
        duplicated = self.doc.replace("PROTO-01 |", "PROTO-02 |", 1)
        with self.assertRaisesRegex(ValueError, "repetido"):
            report_rows(duplicated)

    def test_cubierto_enlaza_prueba_existente(self) -> None:
        verify(self.report, self.matrix)
        key = "PROTO-01"
        forged = {k: list(v) for k, v in self.report.items()}
        forged[key][3] = "CUBIERTO"
        m = {k: list(v) for k, v in self.matrix.items()}
        m[key][2] = "CUBIERTO"
        with self.assertRaisesRegex(ValueError, "PR fusionado"):
            verify(forged, m)

    def test_faltante_tiene_issue(self) -> None:
        verify(self.report, self.matrix)
        for key, row in self.report.items():
            self.assertNotEqual("SIN_COBERTURA", row[3])
            self.assertRegex(self.matrix[key][4], r"^\\[#\\d+\\]\\(https://github\\.com/pl0n3r/AutoFactory/issues/\\d+\\)$")
        forged = {k: list(v) for k, v in self.report.items()}
        forged["PROTO-01"][3] = "SIN_COBERTURA"
        m = {k: list(v) for k, v in self.matrix.items()}
        m["PROTO-01"][2] = "SIN_COBERTURA"
        with self.assertRaisesRegex(ValueError, "Issue hoja"):
            verify(forged, m)

    def test_matriz_actualizada(self) -> None:
        verify(self.report, self.matrix)
        self.assertIn(SELF, self.matrix)
        self.assertEqual(self.matrix[SELF][2], "DESCARTADO")
        self.assertIn("docs/contraste-af_proto.md", self.matrix[SELF][0])
        for key in self.report:
            self.assertIn("Estado operativo: UNKNOWN.", self.matrix[key][3])
        all_rows = [line for line in self.matrix_text.splitlines()
                    if line.startswith("| ") and " · " in line.split("|")[1]]
        self.assertEqual(189, len(all_rows))
        counts = Counter(line.split("|")[3].strip() for line in all_rows)
        self.assertIn("**Total: 189 filas.**", self.matrix_text)
        for state, count in counts.items():
            self.assertIn(f"{state}: **{count}**", self.matrix_text)
        self.assertIn("**Cobertura acreditada: 4.2%**", self.matrix_text)


if __name__ == "__main__":
    unittest.main()
