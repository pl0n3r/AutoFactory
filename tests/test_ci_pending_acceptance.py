"""AutoFactory #277: proof that CI runs the two pending Python acceptance suites."""
from pathlib import Path
import re
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
VALIDATE = ROOT / ".github/workflows/validate.yml"
TITLE = "      - name: Ejecutar aceptación offline #260 y #265 en checkout exacto\n        run: |\n"
PAIRS = (
    ("docs/local-recovery.md", "tests/test_local_recovery_contract.py", "tests.test_local_recovery_contract"),
    ("docs/permisos-extension-auditoria.md", "tests/test_permisos_extension_auditoria.py", "tests.test_permisos_extension_auditoria"),
)


class PendingAcceptanceCITests(unittest.TestCase):
    def _script(self):
        text = VALIDATE.read_text(encoding="utf-8")
        self.assertEqual(text.count(TITLE), 1)
        section = text.split(TITLE, 1)[1].split("\n      - ", 1)[0]
        for row in section.splitlines():
            self.assertTrue(row.startswith("          ") or not row.strip(), row)
        return "\n".join(row[10:] for row in section.splitlines())

    def test_both_suites_are_wired_into_validate(self):
        script = self._script()
        expected_head = 'test "$(git rev-parse HEAD)" = "${{ github.event.pull_request.head.sha || github.sha }}"'
        self.assertIn(expected_head, script)
        self.assertIn("set -euo pipefail", script)
        for doc, test, module in PAIRS:
            self.assertIn(f'if [ -f {doc} ] || [ -f {test} ]; then', script)
            self.assertIn(f"test -f {doc}", script)
            self.assertIn(f"test -f {test}", script)
            self.assertIn(f"python3 -m unittest -v {module}", script)
        self.assertNotIn("python3 -m unittest -v tests.test_ci_pending_acceptance", script)
        workflow = VALIDATE.read_text(encoding="utf-8")
        self.assertIn("if: github.event_name == 'pull_request'", workflow)
        # The author HEAD is intentionally the only checkout: legacy #240
        # enforces this and old PR HEADs lack this self-test module.
        self.assertEqual(workflow.count("uses: actions/checkout@"), 1)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("git fetch --no-tags --depth=1 origin", workflow)
        self.assertIn('test "$(git rev-parse FETCH_HEAD)" = "$MERGE_SHA"', workflow)
        self.assertIn('git worktree add --detach .ci-merge-acceptance "$MERGE_SHA"', workflow)
        self.assertIn('test "$(git -C .ci-merge-acceptance rev-parse HEAD)" = "$MERGE_SHA"', workflow)
        self.assertIn("test -f .ci-merge-acceptance/tests/test_ci_pending_acceptance.py", workflow)
        self.assertIn("(cd .ci-merge-acceptance && python3 -m unittest -v tests.test_ci_pending_acceptance)", workflow)
        self.assertIn("python3 -m unittest -v tests.test_ci_pending_acceptance", workflow)

        # The GitHub expression is evaluated by Actions; exercise the
        # branching with disposable files and a recording python3 stub.
        fixture_script = script.replace(expected_head, ": # exact SHA checked in workflow")
        self.assertNotIn("${{ github.event.pull_request.head.sha || github.sha }}", fixture_script)
        all_paths = [name for doc, test, _ in PAIRS for name in (doc, test)]
        cases = (
            ((), True, ()),
            ((all_paths[0],), False, ()),
            ((all_paths[1],), False, ()),
            ((all_paths[0], all_paths[1]), True, (PAIRS[0][2],)),
            ((all_paths[2],), False, ()),
            ((all_paths[3],), False, ()),
            ((all_paths[2], all_paths[3]), True, (PAIRS[1][2],)),
            (tuple(all_paths), True, (PAIRS[0][2], PAIRS[1][2])),
        )
        for present, should_pass, triggered in cases:
            with self.subTest(present=present), tempfile.TemporaryDirectory() as root:
                home = Path(root)
                for path in present:
                    dest = home / path
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_text("fixture", encoding="utf-8")
                stub = home / "python3"
                stub.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$TRACE"\n', encoding="utf-8")
                stub.chmod(0o755)
                trace = home / "calls.log"
                env = dict(os.environ, PATH=f"{home}:{os.environ.get('PATH', '')}", TRACE=str(trace))
                run = subprocess.run(["/bin/bash", "-e", "-c", fixture_script], cwd=home, env=env, capture_output=True, text=True, check=False)
                self.assertEqual(run.returncode == 0, should_pass, run.stderr)
                observed = trace.read_text(encoding="utf-8").splitlines() if trace.exists() else []
                expected = [f"-m unittest -v {name}" for name in triggered]
                self.assertEqual(observed, expected)

    def _assert_read_only_permissions(self, workflow):
        scopes = re.findall(r"(?m)^permissions:\n((?:^  [^\n]+\n)+)", workflow)
        self.assertEqual(len(scopes), 1, "El workflow debe declarar un solo permiso")
        self.assertEqual(scopes[0].splitlines(), ["  contents: read"])
        self.assertEqual(
            len(re.findall(r"(?m)^\s*permissions:", workflow)), 1,
            "Ningún job puede elevar permisos de GITHUB_TOKEN",
        )
        self.assertNotRegex(
            workflow, r"(?mi)^\s*[\w-]+:\s*write(?:-all)?\s*(?:#.*)?$",
        )

    def test_core_ci_and_permissions_unchanged(self):
        text = VALIDATE.read_text(encoding="utf-8")
        self.assertEqual(text.count("name: Validate / Pruebas y smoke Chrome"), 1)
        self._assert_read_only_permissions(text)
        original = "permissions:\n  contents: read\n"
        self.assertIn(original, text)
        for broken in (
            text.replace(original, "permissions:\n  contents: write\n", 1),
            text.replace(original, "permissions:\n  contents: read\n  actions: write\n", 1),
            text.replace(original, "permissions: write-all\n", 1),
            text.replace("    steps:\n", "    permissions:\n      checks: write\n    steps:\n", 1),
        ):
            with self.subTest(broken=broken[:100]):
                with self.assertRaises(AssertionError):
                    self._assert_read_only_permissions(broken)
        self.assertIn("ref: ${{ github.event.pull_request.head.sha || github.sha }}", text)
        self.assertIn("npm ci --ignore-scripts", text)
        self.assertIn("- run: npm test", text)
        self.assertIn("node scripts/chrome-ephemeral-smoke.cjs", text)
        self.assertIn("python3 -m unittest -v tests.test_ci_salida_quality", text)
        self.assertNotIn("continue-on-error", text)


if __name__ == "__main__":
    unittest.main()
