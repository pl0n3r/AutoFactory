"""AutoFactory #267: CI de aceptación #258 y evidencia CodeQL sin bypass."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
VALIDATE = ROOT / ".github/workflows/validate.yml"
CODEQL = ROOT / ".github/workflows/codeql.yml"


class CiSalidaQualityTests(unittest.TestCase):
    def test_validate_runs_salida_tests_fail_closed(self):
        text = VALIDATE.read_text(encoding="utf-8")
        self.assertEqual(text.count("name: Validate / Pruebas y smoke Chrome"), 1)
        self.assertIn("- run: npm test", text)
        self.assertIn("node scripts/chrome-ephemeral-smoke.cjs", text)
        self.assertIn("set -euo pipefail", text)
        self.assertIn("if [ -f docs/lista-salida-produccion.md ] || [ -f tests/test_lista_salida_produccion.py ]; then", text)
        self.assertIn("test -f docs/lista-salida-produccion.md", text)
        self.assertIn("test -f tests/test_lista_salida_produccion.py", text)
        self.assertIn("python3 -m unittest -v tests.test_lista_salida_produccion", text)
        self.assertIn("python3 -m unittest -v tests.test_ci_salida_quality", text)
        self.assertNotIn("continue-on-error: true", text)
        self.assertRegex(text, r"(?m)^permissions:\n  contents: read$")

    def test_codeql_scan_is_pinned_and_no_upload(self):
        text = CODEQL.read_text(encoding="utf-8")
        self.assertIn("name: CodeQL / Análisis JS y Python", text)
        self.assertIn("  pull_request:\n", text)
        self.assertIn("    branches: [main]", text)
        self.assertIn("permissions:\n  contents: read\n", text)
        self.assertIn("ref: " + chr(36) + "{{ github.event.pull_request.head.sha || github.sha }}", text)
        self.assertIn("languages: javascript-typescript,python", text)
        self.assertIn("output: codeql-results", text)
        self.assertIn("upload: never", text)
        self.assertIn("upload-database: false", text)
        self.assertIn("python3 .factory/scripts/codeql_sarif_summary.py --fail-severity 7.0", text)
        self.assertIn("ref: 9c12107bd64ef4bbc45b3baf4f961a6ce6f14664", text)
        self.assertNotIn("continue-on-error", text)
        self.assertNotRegex(text, r"(?m)^\s+(?:security-events|contents|actions): write$")
        uses = re.findall(r"(?m)^\s+-?\s*uses: (\S+)$", text)
        self.assertEqual(len(uses), 4)
        for item in uses:
            self.assertRegex(item, r"^[\w/-]+@[0-9a-f]{40}$")


if __name__ == "__main__":
    unittest.main()
