#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/coordinacion.yml"
BASE_SHA = "ce82e8eebeb5551238f2a948b1ea2218f4e8333c"


class CoordinationWorkflowContractTests(unittest.TestCase):
    def source(self) -> str:
        return WORKFLOW.read_text(encoding="utf-8")

    def test_commands_delegate_to_versioned_factory_coordination(self) -> None:
        source = self.source()
        for command in (
            "github.event.comment.body == '/tomar'",
            "github.event.comment.body == '/liberar-forzado'",
            "github.event.comment.body == '/adoptar-contrato-huerfana'",
            "startsWith(github.event.comment.body, '/liberar ')",
            "startsWith(github.event.comment.body, '/transferir ')",
            "startsWith(github.event.comment.body, '/migrar-contrato ')",
            "startsWith(github.event.comment.body, '/renovar-contrato ')",
        ):
            self.assertIn(command, source)
        self.assertGreaterEqual(
            source.count("uses: pl0n3r/factory/.github/workflows/coordinacion.yml@v1"),
            6,
        )
        for operation in ("comment", "label", "pr", "validate", "issue", "sweep"):
            self.assertIn(f"operation: {operation}", source)

    def test_consumer_code_is_never_checked_out_or_executed(self) -> None:
        source = self.source()
        self.assertNotIn("actions/checkout@", source)
        self.assertNotIn("repository: pl0n3r/AutoFactory", source)
        self.assertNotIn("working-directory:", source)
        self.assertNotIn("run:", source)
        self.assertIn("permissions:\n  contents: read", source)
        self.assertIn("cancel-in-progress: false", source)

    def test_bootstrap_exception_is_exact_and_self_disabling(self) -> None:
        source = self.source()
        self.assertIn("github.event.pull_request.number == 128", source)
        self.assertIn("github.event.pull_request.head.repo.full_name == github.repository", source)
        self.assertIn("github.event.pull_request.head.ref == 'trabajo/issue-127'", source)
        self.assertIn(f"github.event.pull_request.base.sha == '{BASE_SHA}'", source)
        self.assertIn("require_reservation: ${{ !(github.event.pull_request.number == 128", source)
        self.assertNotIn("require_reservation: false", source)
        self.assertEqual(1, source.count(BASE_SHA))
        self.assertEqual(1, source.count("github.event.pull_request.number == 128"))

    def test_issue_pr_label_and_sweep_events_are_fail_closed(self) -> None:
        source = self.source()
        self.assertIn("types: [created, edited]", source)
        self.assertIn("types: [labeled, closed, reopened]", source)
        self.assertIn(
            "types: [opened, reopened, synchronize, ready_for_review, converted_to_draft, closed]",
            source,
        )
        self.assertIn("github.event.sender.login == github.event.comment.user.login", source)
        self.assertIn("github.event.issue.pull_request == null", source)
        self.assertIn("github.event.label.name == 'estado: reservado'", source)
        self.assertIn("github.event.pull_request.head.repo.full_name == github.repository", source)
        self.assertIn("github.event.pull_request.draft == false", source)
        self.assertIn("github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'", source)
        for forbidden in ("repository_dispatch:", "push:", "workflow_run:"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
