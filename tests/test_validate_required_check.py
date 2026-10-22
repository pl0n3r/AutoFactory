"""AutoFactory #236: contexto de CI inequívoco, sin relajar Validate ni el smoke."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHECK = "Validate / Pruebas y smoke Chrome"


class ValidateRequiredCheckTests(unittest.TestCase):
    def assert_critical_steps_are_blocking(self, job):
        """Exige que los pasos críticos sean reales y no saltaban sus errores."""
        self.assertIn("\n    steps:\n", job)
        source = job.split("\n    steps:\n", 1)[1]
        starts = [match.start() for match in re.finditer(r"(?m)^      - ", source)]
        self.assertTrue(starts, "El job debe contener steps ejecutables")
        steps = [
            source[start:end]
            for start, end in zip(starts, starts[1:] + [len(source)])
        ]
        commands = (
            r"(?m)^      - run: npm test$",
            r"(?m)^        run: node scripts/chrome-ephemeral-smoke\.cjs\s+[^\n]+$",
        )
        for command in commands:
            matches = [step for step in steps if re.search(command, step)]
            self.assertEqual(len(matches), 1, f"Paso ausente o duplicado: {command}")
            self.assertNotRegex(
                matches[0],
                r"(?m)^      - (?:if|continue-on-error):|^        (?:if|continue-on-error):",
                "Un test/smoke requerido no puede omitirse ni ignorar errores",
            )

    def test_unique_validate_context_preserves_real_tests(self):
        """Valida identidad, permisos y pasos bloqueantes del job."""
        workflow = (ROOT / ".github/workflows/validate.yml").read_text(
            encoding="utf-8"
        )
        sonar_relay = (ROOT / ".github/workflows/sonar-check-details.yml").read_text(
            encoding="utf-8"
        )

        # El id del job y el contexto real son distintos; el contexto es único
        # y no existe en el workflow que puede emitir un `test` homónimo/skipped.
        self.assertRegex(
            workflow,
            rf"(?m)^jobs:\n  test:\n    name: {re.escape(CHECK)}\n"
            r"    runs-on: ubuntu-latest$",
        )
        self.assertEqual(workflow.count(f"    name: {CHECK}\n"), 1)
        self.assertRegex(sonar_relay, r"(?m)^  test:\s*$")
        self.assertNotIn(CHECK, sonar_relay)

        # El check requerido nunca debe quedar verde por un skip del job ni
        # suprimir tests, checkout confiable, instalación o smoke real de Chrome.
        job = workflow.split("\njobs:\n", 1)[1]
        self.assertNotRegex(job, r"(?m)^    if:")
        self.assertIn("on:\n  push:\n  pull_request:\n", workflow)
        self.assertIn("permissions:\n  contents: read\n", workflow)
        self.assertNotIn("contents: write", workflow)
        self.assertIn("    timeout-minutes: 20\n", job)
        self.assertIn("persist-credentials: false", job)
        self.assertIn("npm ci --ignore-scripts", job)
        self.assert_critical_steps_are_blocking(job)
        self.assertIn("- run: python3 -m unittest discover -s tests -p 'test_validate_required_check.py' -v", job)
        self.assertIn(
            "name: Real Chrome MV3 extension-load smoke (non-release checkout)",
            job,
        )
        self.assertIn("node scripts/chrome-ephemeral-smoke.cjs", job)
        self.assertIn("node test-workflow-hardening.cjs", job)
        self.assertIn("node test-release-evidence.cjs", job)


    def test_required_steps_reject_skip_and_masking(self):
        """Regresión: alterar cualquier paso crítico hace fallar el guard."""
        job = (ROOT / ".github/workflows/validate.yml").read_text(
            encoding="utf-8"
        ).split("\njobs:\n", 1)[1]
        variants = (
            ("      - run: npm test\n", "      - run: npm test\n        if: false\n"),
            ("      - run: npm test\n", "      - run: npm test\n        continue-on-error: true\n"),
            (
                "        run: node scripts/chrome-ephemeral-smoke.cjs ",
                "        if: false\n        run: node scripts/chrome-ephemeral-smoke.cjs ",
            ),
            (
                "        run: node scripts/chrome-ephemeral-smoke.cjs ",
                "        continue-on-error: true\n        run: node scripts/chrome-ephemeral-smoke.cjs ",
            ),
        )
        for before, after in variants:
            with self.subTest(injection=after):
                self.assertIn(before, job)
                with self.assertRaises(AssertionError):
                    self.assert_critical_steps_are_blocking(job.replace(before, after, 1))


if __name__ == "__main__":
    unittest.main()
