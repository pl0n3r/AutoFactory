"""AutoFactory #258: auditoría reproducible, offline y fail-closed de la salida."""
from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "docs" / "lista-salida-produccion.md"
STATES = frozenset({"LISTO", "EN_CURSO", "SIN_COBERTURA", "DEL_DUEÑO", "NO_APLICA"})
AREAS = frozenset({
    "Respaldos y restauración", "Monitoreo y alertas", "Dominios/DNS/TLS",
    "Secretos y accesos", "Costos y límites", "Privacidad y aspectos legales",
    "Soporte y operación diaria", "Migración de datos",
    "Reversión y apagado de emergencia", "Seguridad (revisión y pruebas)",
    "Accesibilidad y rendimiento", "Smoke de producción",
    "Instalación y actualización Chrome/Safari", "Permisos mínimos",
    "Kill switch", "Pairing real con ControlBot", "Límites de uso de ChatGPT",
})
LEAVES = frozenset({260, 261, 262, 263, 264, 265})
ISSUE = re.compile(
    r"^\[#(?P<n>\d+)\]\(https://github\.com/pl0n3r/AutoFactory/issues/(?P=n)\)$"
)
ROW = re.compile(r"^AF-\d{2}$")


def report():
    if not REPORT.is_file():
        raise AssertionError("Falta docs/lista-salida-produccion.md")
    return REPORT.read_text(encoding="utf-8")


def rows():
    data = []
    for line in report().splitlines():
        if not line.startswith("| AF-"):
            continue
        columns = tuple(cell.strip() for cell in line.strip().strip("|").split("|"))
        if len(columns) != 6:
            raise AssertionError("La tabla debe tener ID + 5 campos: " + line)
        data.append(columns)
    return data


class ListaSalidaTests(unittest.TestCase):
    def test_cubre_todo_el_alcance(self):
        data = rows()
        self.assertGreaterEqual(len(data), 35)
        covered = {area for _, area, *_ in data}
        self.assertEqual(covered, AREAS)
        for concept in ("restauración", "alertas", "DNS", "TLS", "secretos",
                        "costos", "privacidad", "soporte", "migración",
                        "rollback", "seguridad", "accesibilidad", "rendimiento",
                        "smoke", "Chrome", "Safari", "firma", "actualización",
                        "permisos", "kill switch", "pairing", "ChatGPT"):
            with self.subTest(concept=concept):
                self.assertIn(concept.lower(), report().lower())

    def test_sin_cobertura_tiene_issue(self):
        uncovered = set()
        for ident, area, req, state, evidence, link in rows():
            if state != "SIN_COBERTURA":
                continue
            match = ISSUE.fullmatch(link)
            self.assertIsNotNone(match, f"{ident}: hoja real ausente")
            number = int(match.group("n"))
            self.assertIn(number, LEAVES, f"{ident}: no enlaza hoja materializada")
            self.assertNotIn(number, {1, 129, 130, 131, 132, 133, 134, 258})
            self.assertIn(f"https://github.com/pl0n3r/AutoFactory/issues/{number}", evidence)
            uncovered.add(number)
        self.assertEqual(uncovered, LEAVES)

    def test_formato_y_estados(self):
        data = rows()
        seen = set()
        for ident, area, req, state, evidence, link in data:
            with self.subTest(ident=ident):
                self.assertRegex(ident, ROW)
                self.assertNotIn(ident, seen)
                seen.add(ident)
                self.assertIn(state, STATES)
                self.assertGreater(len(req), 18)
                self.assertGreater(len(evidence), 45)
                self.assertTrue(link == "—" or ISSUE.fullmatch(link))
                self.assertNotIn("TODO", evidence.upper())
                if state == "NO_APLICA":
                    self.assertRegex(evidence.lower(), r"sin|no hay|no existe|excluye")
                if state == "DEL_DUEÑO":
                    self.assertRegex(evidence.lower(), r"dueño|propietario|consentimiento|autoriza|decisión|cuenta|firma")
                if state == "LISTO":
                    self.assertRegex(evidence, r"\.js|\.yml|\.md|\.py|Factory#767|PR #251")
                if state == "EN_CURSO":
                    self.assertRegex(link, ISSUE)
        self.assertEqual(len(seen), len(data))

    def test_resumen_final(self):
        data = rows()
        counts = Counter(record[3] for record in data)
        content = report()
        self.assertIn(f"**Total: {len(data)} filas.**", content)
        for state in STATES:
            self.assertIn(f"{state}: **{counts[state]}**", content)
        self.assertIn("Bloquean el go-live", content)
        for marker in ("#219", "#122", "#242", "D-061", "ControlBot #20", "#260–#265"):
            self.assertIn(marker, content)
        self.assertIn("no live", content)


if __name__ == "__main__":
    unittest.main()
