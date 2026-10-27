"""Contrato de AutoFactory #291: trazabilidad offline sin promover UNKNOWN a PASS."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "docs" / "contraste-af_agentes.md"
MATRIX = ROOT / "docs" / "matriz-cobertura.md"
EXCLUDED = {"ISSUE-253", "ISSUE-255", "ISSUE-257"}
ID = re.compile(r"^(?:AGENTES-[0-9-]+|DEC-D-\d+|ISSUE-\d+)$")
ISSUE_LINK = re.compile(r"^\[#(?P<id>\d+)\]\(https://github\.com/pl0n3r/AutoFactory/issues/(?P=id)\)$")
ARTIFACTS = re.compile(r"`([^`]+)`; `([^`]+)`")
STATES = {"NO_VERIFICABLE", "CUBIERTO", "SIN_COBERTURA", "DESCARTADO"}
PR_MERGED = re.compile(r"https://github\.com/pl0n3r/AutoFactory/pull/\d+.*fusionad", re.I)


def matrix_rows(text):
    result = {}
    for line in text.splitlines():
        if not line.startswith("| "):
            continue
        columns = [part.strip() for part in line.strip().strip("|").split("|")]
        if len(columns) != 5:
            continue
        identifier = columns[0].split(" · ", 1)[0]
        if ID.fullmatch(identifier):
            if identifier in result:
                raise ValueError("ID de matriz repetido")
            result[identifier] = columns
    return result


def report_rows(text):
    if text.count("## Veredictos por fila") != 1 or text.count("## Límites y continuación") != 1:
        raise ValueError("secciones ausentes o duplicadas")
    section = text.split("## Veredictos por fila", 1)[1].split("## Límites y continuación", 1)[0]
    result = {}
    for line in section.splitlines():
        if not line.startswith("| "):
            continue
        columns = [part.strip() for part in line.strip().strip("|").split("|")]
        if len(columns) != 5 or not ID.fullmatch(columns[0]):
            continue
        key, source, proof, state, reason = columns
        if key in result:
            raise ValueError("veredicto repetido")
        if not source or len(reason) < 28 or state not in STATES:
            raise ValueError("veredicto incompleto")
        if not ARTIFACTS.fullmatch(proof):
            raise ValueError("ruta o prueba ausente")
        result[key] = columns
    return result


def verify_coverage(rows, matrix):
    for key, (_id, _source, proof, state, reason) in rows.items():
        if matrix[key][2] != state:
            raise ValueError("estado matriz/contraste distinto: " + key)
        artifact, test = ARTIFACTS.fullmatch(proof).groups()
        if not (ROOT / artifact).is_file() or not (ROOT / test).is_file():
            raise ValueError("archivo de evidencia inexistente: " + key)
        if not test.startswith("tests/test_") or not test.endswith(".py"):
            raise ValueError("prueba no reconocida")
        if state == "CUBIERTO" and not PR_MERGED.search(reason):
            raise ValueError("CUBIERTO exige PR fusionado y prueba")
        if state == "SIN_COBERTURA" and (
            "factory-plan-task" not in reason or not re.search(
                r"https://github\.com/pl0n3r/AutoFactory/issues/\d+", reason
            )
        ):
            raise ValueError("faltante requiere Issue hoja canónica")
        if state == "NO_VERIFICABLE" and not any(
            token in reason.lower() for token in ("falta", "pendiente", "no ", "sin ")
        ):
            raise ValueError("UNKNOWN sin causa concreta")


class ContrasteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report_text = REPORT.read_text(encoding="utf-8")
        cls.matrix_text = MATRIX.read_text(encoding="utf-8")
        cls.report = report_rows(cls.report_text)
        cls.matrix = matrix_rows(cls.matrix_text)

    def test_cada_fila_tiene_veredicto(self):
        expected = {key for key, cols in self.matrix.items()
                    if key.startswith(("AGENTES-", "DEC-D-", "ISSUE-"))} - EXCLUDED
        self.assertEqual(45, len(expected))
        self.assertEqual(expected, set(self.report))
        for key in expected:
            self.assertEqual("NO_VERIFICABLE", self.report[key][3])
            self.assertIn(key, self.matrix)
        with self.assertRaises(ValueError):
            report_rows(self.report_text.replace("AGENTES-01-01", "AGENTES-01-02", 1))

    def test_cubierto_enlaza_prueba_existente(self):
        verify_coverage(self.report, self.matrix)
        key = "AGENTES-01-01"
        fake = dict(self.report)
        row = list(fake[key])
        row[3] = "CUBIERTO"
        fake[key] = row
        matching = dict(self.matrix)
        matrix_row = list(matching[key])
        matrix_row[2] = "CUBIERTO"
        matching[key] = matrix_row
        with self.assertRaisesRegex(ValueError, "PR fusionado"):
            verify_coverage(fake, matching)

    def test_faltante_tiene_issue(self):
        for key, cols in self.matrix.items():
            if key not in self.report:
                continue
            self.assertRegex(cols[4], ISSUE_LINK)
            self.assertEqual("NO_VERIFICABLE", self.report[key][3])
        key = "ISSUE-129"
        fake = dict(self.report)
        row = list(fake[key])
        row[3] = "SIN_COBERTURA"
        fake[key] = row
        matching = dict(self.matrix)
        mrow = list(matching[key])
        mrow[2] = "SIN_COBERTURA"
        matching[key] = mrow
        with self.assertRaisesRegex(ValueError, "Issue hoja"):
            verify_coverage(fake, matching)

    def test_matriz_actualizada(self):
        for key, row in self.report.items():
            self.assertIn("Contraste #291:", self.matrix[key][3])
            artifact, test = ARTIFACTS.fullmatch(row[2]).groups()
            self.assertIn(artifact, self.matrix[key][3])
            self.assertIn(test, self.matrix[key][3])
            self.assertIn("UNKNOWN", self.matrix[key][3])
            self.assertEqual(row[3], self.matrix[key][2])
        for key in EXCLUDED:
            self.assertNotIn(key, self.report)
        self.assertIn("**Total: 188 filas.**", self.matrix_text)
        self.assertIn("CUBIERTO: **8**", self.matrix_text)
        self.assertIn("NO_VERIFICABLE: **172**", self.matrix_text)


if __name__ == "__main__":
    unittest.main()
