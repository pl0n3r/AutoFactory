"""AutoFactory #240: aceptación del inventario documental fechado y fail-closed.

No realiza llamadas a GitHub ni declara GREEN: comprueba que las 15 filas
abiertas en el corte observado tienen decisión, evidencia enlazada y dueño del
desbloqueo. Cualquier cambio en el inventario requiere otro corte verificado.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "docs" / "reconciliacion-issues-20261024.md"
EXPECTED_OPEN = frozenset({
    1, 122, 129, 130, 131, 132, 133, 134,
    216, 219, 220, 228, 230, 240, 246,
})
ISSUE_LINK = re.compile(
    r"^\[#(?P<number>\d+)\]\(https://github\.com/pl0n3r/AutoFactory/"
    r"issues/(?P=number)\)$"
)
EVIDENCE = re.compile(r"\[[^]]+\]\(https://(?:github\.com|api\.github\.com)/[^)\s]+\)")


class ReconciliacionIssuesTests(unittest.TestCase):
    def test_acceptance(self) -> None:
        self.assertTrue(REPORT.is_file(), "Missing reconciliación report")
        report = REPORT.read_text(encoding="utf-8")

        self.assertIn("26-oct-2026", report)
        self.assertIn(
            "6eadd42aa234ed453e11d6518cb43d238427fecd", report,
            "Corte documental debe declarar su base exacta",
        )
        self.assertIn("fotografía", report.lower())
        self.assertIn("0 cierres automáticos", report)
        self.assertIn("#220", report)
        self.assertIn("#219", report)
        self.assertIn("sin", report.lower())

        rows = [line for line in report.splitlines() if line.startswith("| [#")]
        self.assertEqual(len(EXPECTED_OPEN), len(rows), "Hay Issues sin fila o duplicados")

        seen: set[int] = set()
        for row in rows:
            columns = [column.strip() for column in row.strip().strip("|").split("|")]
            self.assertEqual(4, len(columns), f"Tabla no canónica: {row}")
            issue, decision, evidence, pending = columns
            match = ISSUE_LINK.fullmatch(issue)
            self.assertIsNotNone(match, f"Issue sin URL canónica: {issue}")
            number = int(match.group("number"))
            self.assertNotIn(number, seen, f"Issue duplicado: #{number}")
            seen.add(number)

            self.assertIn(decision, {"Mantener abierto", "Actualizar"})
            self.assertRegex(evidence, EVIDENCE)
            self.assertGreater(len(pending), 65, f"Sin delta o autoridad para #{number}")
            self.assertNotIn("TODO", pending.upper())
            self.assertNotIn("PENDIENTE DE INVESTIGAR", pending.upper())

        self.assertSetEqual(EXPECTED_OPEN, seen)
        self.assertIn("[#246](https://github.com/pl0n3r/AutoFactory/issues/246)", report)
        self.assertIn("[PR #247](https://github.com/pl0n3r/AutoFactory/pull/247)", report)
        self.assertIn("[#240](https://github.com/pl0n3r/AutoFactory/issues/240)", report)
        self.assertIn("[#243](https://github.com/pl0n3r/AutoFactory/issues/243)", report)
        self.assertIn("CLOSED/completed", report)
        self.assertIn("issuecomment-6419013464", report)
        self.assertIn("15 issues OPEN inventariados", report)
        self.assertIn("20 objetos incluyendo 5 PR", report)
        self.assertIn("[PR #248](https://github.com/pl0n3r/AutoFactory/pull/248)", report)
        self.assertIn("PR sin Issue de trabajo verificable", report)
        self.assertIn("test-workflow-hardening.cjs", report)
        self.assertIn("falta Validate como requerido", report)

        # El workflow debe ejecutar AC-01 sobre el commit del autor del PR,
        # no sobre el merge ref sintético que Actions instala por defecto.
        workflow = (ROOT / ".github/workflows/validate.yml").read_text(
            encoding="utf-8",
        )
        self.assertIn(
            "ref: ${{ github.event.pull_request.head.sha || github.sha }}",
            workflow,
        )
        self.assertIn("path: .acceptance-head", workflow)
        self.assertIn("working-directory: .acceptance-head", workflow)
        self.assertIn('test "$(git rev-parse HEAD)" =', workflow)
        self.assertIn(
            "python3 -m unittest -v tests.test_reconciliacion_issues_20261024.ReconciliacionIssuesTests.test_acceptance",
            workflow,
        )
        self.assertIn("no", report.lower())


if __name__ == "__main__":
    unittest.main()
