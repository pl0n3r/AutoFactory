"""AutoFactory #432: traceability without promoting historical coverage.

Offline-only. The test reads only files from the exact checkout; no network,
browser, Sonar credentials, user sessions or remote bridge are needed.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "docs" / "matriz-cobertura.md"
MAIN_ID = re.compile(r"^(?:AF1-AC|README|AGENTES|PROTO|DOC|ISSUE|DEC|HIST)-[A-Z0-9-]+$")
MAPPING = re.compile(
    r"^\| .(?P<id>[A-Z0-9-]+). \| "
    r"(?P<verdict>CANDIDATA_LOCAL|SIN_CANDIDATA|DESCARTADO) \| "
    r"(?P<code>—|.[A-Za-z0-9_.\-/]+\.(?:js|cjs|py).) \| "
    r"(?P<test>—|.(?:tests/test_[A-Za-z0-9_.\-/]+\.py|test-[A-Za-z0-9_.\-/]+\.cjs).) \|$"
)
VALID_STATES = {"NO_VERIFICABLE", "CUBIERTO", "DESCARTADO", "EN_CURSO"}
NOT_BEHAVIORAL = ("tests/test_matriz_cobertura.py", "tests/test_contraste_af_readme.py")


def main_rows(text: str) -> dict[str, tuple[str, str]]:
    """Preserve the historic five-column inventory exactly."""
    rows = {}
    for line in text.splitlines():
        if not line.startswith("| "):
            continue
        cols = [x.strip() for x in line[1:-1].split("|")]
        row_id = cols[0].split(" · ", 1)[0]
        if not MAIN_ID.fullmatch(row_id):
            continue
        if len(cols) != 5 or row_id in rows or cols[2] not in VALID_STATES:
            raise ValueError("Invalid historic inventory row")
        rows[row_id] = (cols[2], cols[3])
    return rows


def map_rows(text: str) -> dict[str, tuple[str, str, str]]:
    if text.count("## Candidatas por requisito (#432)") != 1:
        raise ValueError("Missing or duplicate candidate section")
    section = text.split("## Candidatas por requisito (#432)", 1)[1]
    if "| ID | Veredicto | Código candidato | Prueba candidata |" not in section:
        raise ValueError("Missing candidate columns")
    rows = {}
    for line in section.splitlines():
        if not line.startswith("| " + chr(96)):
            continue
        match = MAPPING.fullmatch(line)
        if match is None:
            raise ValueError("Malformed candidate row")
        row_id = match["id"]
        if row_id in rows:
            raise ValueError("Duplicate candidate row")
        rows[row_id] = tuple(match[key] for key in ("verdict", "code", "test"))
    return rows


def candidate_path(value: str) -> Path | None:
    if value == "—":
        return None
    relative = value.strip(chr(96))
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("Candidate escapes repository")
    resolved = (ROOT / path).resolve()
    if not resolved.is_relative_to(ROOT.resolve()) or not resolved.is_file():
        raise ValueError("Candidate file missing or external")
    return resolved


class MatrizAutofactoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = REPORT.read_text(encoding="utf-8")

    def test_criterio_principal(self) -> None:
        """AC-01: 1:1 map, real paths, conservative unchanged status."""
        source = main_rows(self.text)
        mapped = map_rows(self.text)
        self.assertEqual(len(source), 189)
        self.assertEqual(set(mapped), set(source))
        self.assertEqual(
            Counter(state for state, _ in source.values()),
            Counter({"NO_VERIFICABLE": 158, "CUBIERTO": 22,
                     "DESCARTADO": 8, "EN_CURSO": 1})
        )
        verdicts = Counter()
        for ident, (verdict, code, test) in mapped.items():
            with self.subTest(ident=ident):
                verdicts[verdict] += 1
                status, evidence = source[ident]
                if status == "DESCARTADO":
                    self.assertEqual((verdict, code, test), ("DESCARTADO", "—", "—"))
                elif verdict == "CANDIDATA_LOCAL":
                    self.assertIsNotNone(candidate_path(code))
                    self.assertIsNotNone(candidate_path(test))
                    self.assertIn(code, evidence)
                    self.assertIn(test, evidence)
                    self.assertNotIn(test.strip(chr(96)), NOT_BEHAVIORAL)
                else:
                    self.assertEqual((verdict, code, test),
                                     ("SIN_CANDIDATA", "—", "—"))
        self.assertEqual(verdicts, Counter({
            "CANDIDATA_LOCAL": 48, "SIN_CANDIDATA": 133, "DESCARTADO": 8
        }))
        self.assertIn("no que su aserción cumpla la cláusula", self.text)
        self.assertIn("NO_VERIFICABLE", self.text)
        self.assertIn("sin pareja respaldada por la evidencia", self.text)

    def test_rechaza_filas_duplicadas_o_invalidas(self) -> None:
        mapped = map_rows(self.text)
        first_id, values = next(iter(mapped.items()))
        row = "| " + chr(96) + first_id + chr(96) + " | " + " | ".join(values) + " |"
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            map_rows(self.text + "\n" + row + "\n")
        with self.assertRaisesRegex(ValueError, "Malformed"):
            map_rows(self.text + "\n| " + chr(96) +
                     "INVENTADO" + chr(96) + " | CUBIERTO | — | — |\n")

    def test_rechaza_rutas_fuera_de_repositorio(self) -> None:
        with self.assertRaisesRegex(ValueError, "escapes"):
            candidate_path(chr(96) + "../../escape.py" + chr(96))
        with self.assertRaisesRegex(ValueError, "missing"):
            candidate_path(chr(96) + "tests/test_inexistente_af432.py" + chr(96))
        self.assertIsNone(candidate_path("—"))

    def test_no_duplica_inventario_historico(self) -> None:
        self.assertEqual(len(main_rows(self.text)), 189)
        self.assertEqual(len(map_rows(self.text)), 189)


if __name__ == "__main__":
    unittest.main()
