"""AutoFactory #281: contrato fail-closed de partición #129–#134, solo offline."""
from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "particion-roadmaps-puente.md"
ROADMAPS = frozenset(range(129, 135))
LEAVES = {129: 282, 130: 283, 131: 284, 132: 285, 133: 286, 134: 287}
# IDs and OPEN state verified through authenticated GitHub before authoring.
# This regression is an immutable snapshot, NOT a substitute for live GitHub reads.
SNAPSHOT_OPEN_ISSUES = ROADMAPS | frozenset(LEAVES.values())
DONE_PRS = frozenset({215, 245, 239, 254, 247, 251, 280})
ISSUE_LINK = re.compile(
    r"^\[#(?P<num>[0-9]+)\]\(https://github\.com/pl0n3r/AutoFactory/issues/(?P=num)\)$"
)
PR_LINK = re.compile(
    r"\[PR #(?P<num>[0-9]+)\]\(https://github\.com/pl0n3r/AutoFactory/pull/(?P=num)\)"
)
STATES = frozenset({"DISPONIBLE_OFFLINE", "BLOQUEADO_REAL"})


def document() -> str:
    if not DOC.is_file():
        raise AssertionError("Falta docs/particion-roadmaps-puente.md")
    return DOC.read_text(encoding="utf-8")


def records(text: str | None = None) -> list[tuple[int, str, str, str, int]]:
    if text is None:
        text = document()
    result = []
    for line in text.splitlines():
        if not re.match(r"^\| #(?:129|130|131|132|133|134) \|", line):
            continue
        fields = tuple(cell.strip() for cell in line.strip().strip("|").split("|"))
        if len(fields) != 5:
            raise AssertionError(f"Columnas inválidas: {line}")
        road, leaf, state, dependency, link = fields
        if not re.fullmatch(r"#[0-9]+", road):
            raise AssertionError(f"Roadmap no canónico: {road}")
        match = ISSUE_LINK.fullmatch(link)
        if match is None:
            raise AssertionError(f"Enlace de Issue inválido: {link}")
        result.append((int(road[1:]), leaf, state, dependency, int(match.group("num"))))
    return result


class ParticionTests(unittest.TestCase):
    def test_cubre_roadmaps_129_a_134(self) -> None:
        rows = records()
        self.assertEqual(12, len(rows), "Se requiere hoja offline + gate real por roadmap")
        self.assertEqual(ROADMAPS, {record[0] for record in rows})
        self.assertEqual(
            Counter((number, state) for number in ROADMAPS for state in STATES),
            Counter((number, state) for number, _, state, _, _ in rows),
        )
        self.assertIn("| Roadmap | Hoja | Estado | Dependencia | Issue |", document())
        self.assertEqual(12, len(set((row[0], row[2]) for row in rows)))
        for number, name, state, dependency, issue in rows:
            with self.subTest(roadmap=number, state=state):
                self.assertIn(state, STATES)
                self.assertGreater(len(name), 15)
                self.assertGreater(len(dependency), 12)
                self.assertNotEqual("UNKNOWN", dependency.upper())
                if state == "DISPONIBLE_OFFLINE":
                    self.assertNotEqual(number, issue)
                else:
                    self.assertEqual(number, issue)

    def test_cada_hoja_tiene_issue_real(self) -> None:
        rows = records()
        seen_leaves = set()
        for number, _name, state, _dep, issue in rows:
            with self.subTest(roadmap=number, state=state):
                self.assertIn(issue, SNAPSHOT_OPEN_ISSUES)
                if state == "DISPONIBLE_OFFLINE":
                    self.assertEqual(LEAVES[number], issue)
                    self.assertNotIn(issue, seen_leaves)
                    seen_leaves.add(issue)
                else:
                    self.assertEqual(number, issue)
        self.assertEqual(set(LEAVES.values()), seen_leaves)
        # Historical slices are explicitly labeled merged, not inferred from
        # the check status of an unrelated PR or from CI of this partition.
        urls = {int(match.group("num")) for match in PR_LINK.finditer(document())}
        self.assertTrue(DONE_PRS.issubset(urls))
        for issue in SNAPSHOT_OPEN_ISSUES:
            self.assertIn(
                f"https://github.com/pl0n3r/AutoFactory/issues/{issue}", document()
            )

    def test_sin_activacion_real(self) -> None:
        text = document()
        for invariant in (
            "NO_ACTIVAR_BRIDGE", "NO-GO", "D-061", "ControlBot#20",
            "consentimiento", "sin conexión", "#219", "#122",
            "sin alterar runtime, manifiestos ni permisos",
            "Los roadmaps #129–#134 y el épico #1 permanecen **OPEN**",
        ):
            with self.subTest(invariant=invariant):
                self.assertIn(invariant, text)
        for forbidden in (
            "factory-control-bridge-live=true",
            "consent_verified=true",
            "CONTROLBOT_TOKEN=",
            "-----BEGIN PRIVATE KEY-----",
            "endpoint de producción activo",
        ):
            self.assertNotIn(forbidden, text)
        self.assertTrue(all(
            state in STATES for _number, _leaf, state, _dep, _issue in records()
        ))
        # This issue claims only a document and a regression test; no JavaScript,
        # permissions, release metadata or network stack must be part of its scope.
        self.assertIn(
            "la partición #281 añade solo este documento y su prueba", text
        )

    def test_dependencias_explicitas(self) -> None:
        rows = records()
        dependencies = {(number, state): dependency
                        for number, _leaf, state, dependency, _issue in rows}
        for n in ROADMAPS:
            with self.subTest(roadmap=n):
                self.assertNotIn("por definir", dependencies[(n, "DISPONIBLE_OFFLINE")].lower())
                self.assertIn("D-061", dependencies[(n, "BLOQUEADO_REAL")])
                self.assertIn("ControlBot#20", dependencies[(n, "BLOQUEADO_REAL")])
        for dependency in (282, 283, 284, 285):
            self.assertIn(f"#{dependency}", dependencies[(133, "DISPONIBLE_OFFLINE")])
        self.assertIn("#286", dependencies[(134, "DISPONIBLE_OFFLINE")])
        for dependency in (133, 219, 122):
            self.assertIn(f"#{dependency}", dependencies[(134, "BLOQUEADO_REAL")])
        text = document()
        self.assertIn("#216", text)
        self.assertIn("#89", text)
        self.assertIn("NO_ACTIVAR_BRIDGE", text)
        self.assertNotRegex(text, r"(?:#undefined|depends_on.*null)")
        self.assertEqual(
            {number for number, _, state, _, _ in rows
             if state == "BLOQUEADO_REAL"}, ROADMAPS
        )


if __name__ == "__main__":
    unittest.main()
