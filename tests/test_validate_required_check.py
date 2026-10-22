"""AutoFactory #236: contexto de CI inequívoco, sin relajar Validate ni el smoke."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHECK = "Validate / Pruebas y smoke Chrome"


class ValidateRequiredCheckTests(unittest.TestCase):
    def test_unique_validate_context_preserves_real_tests(self):
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
        self.assertIn("      - run: npm test\n", job)
        self.assertIn("- run: python3 -m unittest discover -s tests -p 'test_validate_required_check.py' -v", job)
        self.assertIn(
            "name: Real Chrome MV3 extension-load smoke (non-release checkout)",
            job,
        )
        self.assertIn("node scripts/chrome-ephemeral-smoke.cjs", job)
        self.assertIn("node test-workflow-hardening.cjs", job)
        self.assertIn("node test-release-evidence.cjs", job)


if __name__ == "__main__":
    unittest.main()
