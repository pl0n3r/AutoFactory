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


    def test_dispatch_exact_main_preserves_required_check(self):
        """Dispatch cannot escalate privileges and fails closed on ref/SHA drift."""
        import os
        import subprocess
        import tempfile

        workflow = (ROOT / ".github/workflows/validate.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("on:\n  push:\n  pull_request:\n  workflow_dispatch:\n", workflow)
        self.assertEqual(workflow.count("  workflow_dispatch:\n"), 1)
        self.assertEqual(workflow.count("    name: " + CHECK + "\n"), 1)
        self.assertIn("permissions:\n  contents: read\n", workflow)
        self.assertNotIn("pull_request_target:", workflow)
        self.assertNotIn("continue-on-error", workflow)
        self.assertNotIn("inputs:", workflow)
        self.assertNotIn("secrets:", workflow)
        self.assertIn("ref: $" + "{{ github.event.pull_request.head.sha || github.sha }}", workflow)
        self.assertIn("if: github.event_name == 'pull_request'", workflow)
        self.assertIn("git worktree add --detach .ci-merge-acceptance", workflow)

        def extract(name):
            prefix = "      - name: " + name + "\n"
            self.assertEqual(workflow.count(prefix), 1)
            block = workflow.split(prefix, 1)[1].split("\n      - ", 1)[0]
            self.assertIn("        if: github.event_name == 'workflow_dispatch'\n", block)
            self.assertIn("        run: |\n", block)
            source = block.split("        run: |\n", 1)[1]
            self.assertNotIn("continue-on-error", source)
            return "\n".join(
                line[10:] for line in source.splitlines() if line.strip()
            ) + "\n"

        before = extract("Rechazar dispatch no-main o SHA desfasado")
        after = extract("Exigir SHA main sin drift tras smoke de dispatch")
        self.assertLess(workflow.index("Rechazar dispatch no-main"),
                        workflow.index("actions/checkout@"))
        self.assertGreater(workflow.index("Exigir SHA main sin drift"),
                           workflow.index("node test-release-evidence.cjs"))
        for expected in ('test "$GITHUB_EVENT_NAME" = "workflow_dispatch"',
                         'test "$GITHUB_REF" = "refs/heads/main"',
                         'test "$GITHUB_REF_TYPE" = "branch"',
                         '[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]',
                         "git ls-remote",
                         'test "$REMOTE_SHA" = "$GITHUB_SHA"'):
            self.assertIn(expected, before)
        for expected in ('git rev-parse HEAD', "git ls-remote origin refs/heads/main",
                         'test "$REMOTE_SHA" = "$GITHUB_SHA"'):
            self.assertIn(expected, after)
        self.assertNotIn("git push", before + after)
        self.assertNotIn("gh api", before + after)

        sha = "1" * 40
        with tempfile.TemporaryDirectory() as tmp:
            # Exercise shell checks without network or a GitHub token.
            fake_git = Path(tmp) / "git"
            fake_git.write_text(
                "#!/bin/sh\n"
                "case \"$1\" in\n"
                "  ls-remote) printf '%s\\t%s\\n' \"$FAKE_MAIN_SHA\" \"refs/heads/main\" ;;\n"
                "  rev-parse) printf '%s\\n' \"$FAKE_CHECKOUT_SHA\" ;;\n"
                "  *) exit 1 ;;\n"
                "esac\n",
                encoding="utf-8",
            )
            fake_git.chmod(0o755)
            env = dict(
                os.environ,
                PATH=f"{tmp}:{os.environ.get('PATH', '')}",
                GITHUB_EVENT_NAME="workflow_dispatch",
                GITHUB_REF="refs/heads/main",
                GITHUB_REF_TYPE="branch",
                GITHUB_REPOSITORY="pl0n3r/AutoFactory",
                GITHUB_SHA=sha,
                FAKE_MAIN_SHA=sha,
                FAKE_CHECKOUT_SHA=sha,
            )

            def verify(script, overrides=None):
                variables = dict(env, **(overrides or {}))
                result = subprocess.run(
                    ["/bin/bash", "-e", "-c", script],
                    env=variables,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                return result.returncode == 0

            self.assertTrue(verify(before))
            self.assertTrue(verify(after))
            for overrides in (
                {"GITHUB_EVENT_NAME": "pull_request"},
                {"GITHUB_REF": "refs/heads/feature"},
                {"GITHUB_REF": "refs/tags/v1"},
                {"GITHUB_REF_TYPE": "tag"},
                {"GITHUB_REPOSITORY": "outsider/AutoFactory"},
                {"GITHUB_SHA": "not-a-sha"},
                {"FAKE_MAIN_SHA": "2" * 40},
                {"FAKE_MAIN_SHA": ""},
            ):
                with self.subTest(bad=overrides):
                    self.assertFalse(verify(before, overrides))
            for overrides in (
                {"GITHUB_REF": "refs/heads/other"},
                {"FAKE_MAIN_SHA": "2" * 40},
                {"FAKE_CHECKOUT_SHA": "2" * 40},
            ):
                with self.subTest(postcheck=overrides):
                    self.assertFalse(verify(after, overrides))

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
                mutated_job = job.replace(before, after, 1)
                with self.assertRaises(AssertionError):
                    self.assert_critical_steps_are_blocking(mutated_job)


if __name__ == "__main__":
    unittest.main()
