"""Issue #292: regression of README contrast without invented coverage."""
from collections import Counter
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "docs/contraste-af_readme.md"
MATRIX = ROOT / "docs/matriz-cobertura.md"
README = ROOT / "README.md"
STATES = {"CUBIERTO", "NO_VERIFICABLE", "SIN_COBERTURA", "DESCARTADO"}
PROOF = re.compile(r"^\x60([^\x60]+)\x60; \x60([^\x60]+)\x60$")
MERGED = re.compile(r"https://github\.com/pl0n3r/AutoFactory/pull/\d+.*fusionad", re.I)
ISSUE = re.compile(r"https://github\.com/pl0n3r/AutoFactory/issues/(\d+)")


def read_matrix(text):
    result = {}
    for line in text.splitlines():
        if not line.startswith("| README-"):
            continue
        parts = [p.strip() for p in line.strip().strip("|").split("|")]
        if len(parts) != 5:
            raise ValueError("fila matriz inválida")
        key = parts[0].split(" · ", 1)[0]
        if not re.fullmatch(r"README-\d{2}-\d{2}", key) or key in result:
            raise ValueError("ID duplicado o inválido")
        result[key] = parts
    return result


def read_report(text):
    if text.count("## Veredictos por fila") != 1 or text.count("## Límites y continuación") != 1:
        raise ValueError("secciones del contraste incorrectas")
    section = text.split("## Veredictos por fila", 1)[1].split("## Límites y continuación", 1)[0]
    result = {}
    for line in section.splitlines():
        if not line.startswith("| README-"):
            continue
        parts = [p.strip() for p in line.strip().strip("|").split("|")]
        if len(parts) != 5:
            raise ValueError("fila del contraste inválida")
        key = parts[0]
        if not re.fullmatch(r"README-\d{2}-\d{2}", key) or key in result:
            raise ValueError("veredicto repetido o inválido")
        if parts[3] not in STATES or len(parts[4]) < 100 or not PROOF.fullmatch(parts[2]):
            raise ValueError("veredicto o evidencia insuficiente")
        result[key] = parts
    return result


def verify(report, matrix):
    for key, row in report.items():
        if key not in matrix or row[3] != matrix[key][2]:
            raise ValueError("matriz y contraste divergentes")
        proof = PROOF.fullmatch(row[2])
        if proof is None:
            raise ValueError("prueba ausente")
        source, test = proof.groups()
        if not (ROOT / source).is_file() or not (ROOT / test).is_file():
            raise ValueError("archivo de evidencia inexistente")
        if not test.startswith("tests/test_") or not test.endswith(".py"):
            raise ValueError("ruta de prueba inválida")
        if row[3] == "CUBIERTO" and not MERGED.search(row[4]):
            raise ValueError("CUBIERTO exige PR fusionado")
        if row[3] == "SIN_COBERTURA" and (
            "factory-plan-task" not in row[4] or
            not (m := ISSUE.search(row[4])) or int(m.group(1)) == 1
        ):
            raise ValueError("SIN_COBERTURA exige Issue hoja canónica")
        if row[3] == "NO_VERIFICABLE" and "Falta" not in row[4]:
            raise ValueError("NO_VERIFICABLE sin límite concreto")


class ContrasteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = REPORT.read_text(encoding="utf-8")
        cls.matrix_text = MATRIX.read_text(encoding="utf-8")
        cls.report = read_report(cls.doc)
        cls.matrix = read_matrix(cls.matrix_text)

    def test_cada_fila_tiene_veredicto(self):
        self.assertTrue(README.is_file())
        self.assertEqual(73, len(self.matrix))
        self.assertEqual(set(self.matrix), set(self.report))
        for key, row in self.report.items():
            with self.subTest(id=key):
                self.assertEqual("README.md", row[1].split(" — ", 1)[0])
                self.assertIn(self.matrix[key][1], row[1])
                self.assertIn(key, row[4])
        with self.assertRaisesRegex(ValueError, "repetido"):
            read_report(self.doc.replace("README-01-01 |", "README-01-02 |", 1))

    def test_cubierto_enlaza_prueba_existente(self):
        verify(self.report, self.matrix)
        self.assertFalse(any(row[3] == "CUBIERTO" for row in self.report.values()))
        fake = {k: list(v) for k, v in self.report.items()}
        fake["README-01-01"][3] = "CUBIERTO"
        matrix = {k: list(v) for k, v in self.matrix.items()}
        matrix["README-01-01"][2] = "CUBIERTO"
        with self.assertRaisesRegex(ValueError, "PR fusionado"):
            verify(fake, matrix)

    def test_faltante_tiene_issue(self):
        self.assertFalse(any(row[3] == "SIN_COBERTURA" for row in self.report.values()))
        for key, row in self.matrix.items():
            with self.subTest(id=key):
                self.assertRegex(row[4], r"^\[#\d+\]\(https://github\.com/pl0n3r/AutoFactory/issues/\d+\)$")
        fake = {k: list(v) for k, v in self.report.items()}
        fake["README-01-01"][3] = "SIN_COBERTURA"
        matrix = {k: list(v) for k, v in self.matrix.items()}
        matrix["README-01-01"][2] = "SIN_COBERTURA"
        with self.assertRaisesRegex(ValueError, "Issue hoja"):
            verify(fake, matrix)

    def test_matriz_actualizada(self):
        verify(self.report, self.matrix)
        for key, row in self.report.items():
            with self.subTest(id=key):
                self.assertIn("Contraste #292:", self.matrix[key][3])
                self.assertIn("docs/contraste-af_readme.md", self.matrix[key][3])
                self.assertIn("tests/test_contraste_af_readme.py", self.matrix[key][3])
                self.assertIn("UNKNOWN", self.matrix[key][3])
        meta = next((line for line in self.matrix_text.splitlines()
                     if line.startswith("| DOC-CONTRASTE-AF-PROTO-01 · ")), "")
        self.assertIn("docs/contraste-af_readme.md", meta)
        self.assertIn("**Total: 189 filas.**", self.matrix_text)
        self.assertIn("NO_VERIFICABLE: **172**", self.matrix_text)
        self.assertIn("CUBIERTO: **8**", self.matrix_text)
        self.assertEqual(Counter({"NO_VERIFICABLE": 73}),
                         Counter(row[3] for row in self.report.values()))


if __name__ == "__main__":
    unittest.main()
