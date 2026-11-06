"""Pruebas de la puerta OWNER del caller CAS V3 (issue #466)."""
import re
import unittest
from pathlib import Path
from types import SimpleNamespace

CALLER = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "coordinacion.yml"
SHA = "7f9b796f6b1dc352075273d3d8e2ceba67665fba"
UUID = "327c4295-b5a8-4f88-8304-08f20c43ff3b"
VALID = f"/recuperar-lock-v3-activa {SHA} {UUID}"


def job(text, name):
    match = re.search(rf"(?m)^  {re.escape(name)}:\n((?:    .*\n|\n)*)", text)
    if not match:
        raise AssertionError(f"Falta job: {name}")
    return match.group(1)


def guard(block):
    match = re.search(r"(?m)^    if: >-\n((?:      .*\n)+)", block)
    if not match:
        raise AssertionError("Falta condición de job")
    return " ".join(line.strip() for line in match.group(1).splitlines())


def allowed(expr, body, *, author="pl0n3r", sender="pl0n3r", is_pr=False, event="issue_comment"):
    github = SimpleNamespace(
        event_name=event,
        event=SimpleNamespace(
            issue=SimpleNamespace(pull_request=object() if is_pr else None),
            sender=SimpleNamespace(login=sender),
            comment=SimpleNamespace(body=body, user=SimpleNamespace(login=author)),
        ),
    )
    source = expr.replace("&&", " and ").replace("||", " or ")
    source = re.sub(r"\bnull\b", "None", source)
    return bool(eval(source, {"__builtins__": {}}, {
        "github": github,
        "startsWith": lambda text, prefix: text.startswith(prefix),
    }))


def shell_regex(block):
    match = re.search(r'(?m)^\s+if \[\[ "\$BODY" =~ (.+) \]\]; then$', block)
    if not match:
        raise AssertionError("Validación shell no encontrada")
    return re.compile(match.group(1))


class LockCallerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = CALLER.read_text(encoding="utf-8")
        cls.preflight = job(cls.source, "validar_recuperacion_v3")
        cls.condition = guard(cls.preflight)
        cls.pattern = shell_regex(cls.preflight)
        cls.caller = job(cls.source, "recuperar_v3")
        cls.legacy = job(cls.source, "comentario")

    def test_owner_only_and_issue_only(self):
        self.assertTrue(allowed(self.condition, VALID))
        self.assertIsNotNone(self.pattern.fullmatch(VALID))
        for props in (
            {"author": "outsider", "sender": "outsider"},
            {"sender": "outsider"},
            {"is_pr": True},
            {"event": "pull_request"},
            {"event": "issues"},
        ):
            with self.subTest(props=props):
                self.assertFalse(allowed(self.condition, VALID, **props))

    def test_no_ambiguous_prefix(self):
        for body in (
            "texto " + VALID,
            "/recuperar-lock-v3-activa",
            "/recuperar-lock-v3-activa-extra " + SHA + " " + UUID,
            " " + VALID,
            VALID.upper(),
            VALID.replace(" ", "\n", 1),
        ):
            with self.subTest(body=body):
                self.assertFalse(allowed(self.condition, body))

    def test_invalid_sha_uuid_whitespace_or_replay_is_rejected(self):
        for body in (
            f"/recuperar-lock-v3-activa {SHA[:-1]} {UUID}",
            f"/recuperar-lock-v3-activa {'g' * 40} {UUID}",
            f"/recuperar-lock-v3-activa {SHA} {'0' * 36}",
            f"/recuperar-lock-v3-activa {SHA} {UUID.upper()}",
            VALID + " adicional", VALID + "\n/tomar", VALID + "\n",
            VALID.replace(" ", "  ", 1), VALID.replace(" ", "\t", 1),
        ):
            with self.subTest(body=body):
                self.assertIsNone(self.pattern.fullmatch(body))
        self.assertTrue(self.pattern.pattern.startswith("^/recuperar-lock-v3-activa"))
        self.assertTrue(self.pattern.pattern.endswith("$"))

    def test_gate_fails_closed_before_reusable(self):
        self.assertIn("github.event.comment.user.login == 'pl0n3r'", self.condition)
        self.assertIn("github.event.sender.login == github.event.comment.user.login", self.condition)
        self.assertIn("github.event.issue.pull_request == null", self.condition)
        self.assertIn("BODY: ${{ github.event.comment.body }}", self.preflight)
        self.assertIn('echo "valid=true" >> "$GITHUB_OUTPUT"', self.preflight)
        self.assertIn("exit 1", self.preflight)
        self.assertIn("needs: validar_recuperacion_v3", self.caller)
        self.assertIn("needs.validar_recuperacion_v3.result == 'success'", self.caller)
        self.assertIn("needs.validar_recuperacion_v3.outputs.valid == 'true'", self.caller)
        self.assertIn("uses: pl0n3r/factory/.github/workflows/coordinacion.yml@v1", self.caller)
        for field in (
            "operation: comment",
            "issue_number: ${{ github.event.issue.number }}",
            "actor: ${{ github.event.comment.user.login }}",
            "association: ${{ github.event.comment.author_association }}",
            "body: ${{ github.event.comment.body }}",
        ):
            self.assertIn(field, self.caller)

    def test_legacy_commands_are_unchanged(self):
        orig = guard(self.legacy)
        for command in (
            "/tomar", "/liberar-forzado", "/adoptar-contrato-huerfana",
            "/liberar abc", "/transferir pl0n3r", "/migrar-contrato abc",
            "/renovar-contrato abc",
        ):
            with self.subTest(command=command):
                self.assertTrue(allowed(orig, command))
        self.assertFalse(allowed(orig, VALID))
        self.assertIn("concurrency:\n  group: coordinacion-", self.source)
        self.assertIn("cancel-in-progress: false", self.source)
        self.assertIn("permissions:\n  contents: read", self.source)
        self.assertIn("permissions:\n      contents: read", self.preflight)
        for permission in ("contents: write", "issues: write", "pull-requests: write", "checks: write"):
            self.assertIn(permission, self.caller)


if __name__ == "__main__":
    unittest.main()
