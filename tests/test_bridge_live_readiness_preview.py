"""AutoFactory #287: deterministic NO-GO receipt; never a live authority."""
from __future__ import annotations

import copy
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/bridge-live-readiness-preview.md"
PACKAGE = ROOT / "package.json"
VALIDATE = ROOT / ".github/workflows/validate.yml"
GATES = frozenset((
    "e2e_133", "consent_d061", "security_219", "safari_122",
    "branch_protection", "rollback", "owner_only",
))
RECEIPT_FIELDS = frozenset((
    "schema", "mode", "decision", "owner_gate", "now_tick", "evidence",
))
EVIDENCE_FIELDS = frozenset((
    "state", "receipt_id", "observed_tick", "revoked", "replayed",
))


def load_fixture() -> dict:
    source = DOC.read_text(encoding="utf-8")
    fence = re.escape(chr(96) * 3)
    blocks = re.findall(rf"(?ms)^{fence}json\n(.*?)\n{fence}$", source)
    if len(blocks) != 1:
        raise AssertionError("Exactly one synthetic JSON receipt is required")
    return json.loads(blocks[0])


def evaluate_preview(candidate: object) -> dict[str, object]:
    """No outcome from this evaluator may authorize a real bridge or OWNER gate."""
    def denied(reason: str) -> dict[str, object]:
        return {"decision": "NO_GO", "synthetic_complete": False, "reason": reason}

    if type(candidate) is not dict or set(candidate) != RECEIPT_FIELDS:
        return denied("untrusted_receipt")
    if (candidate["schema"] != "bridge-live-readiness-preview/v1"
            or candidate["mode"] != "OFFLINE_SYNTHETIC"
            or candidate["decision"] != "NO_GO"
            or candidate["owner_gate"] != "NOT_GRANTED"):
        return denied("untrusted_authority")
    now = candidate["now_tick"]
    evidence = candidate["evidence"]
    if type(now) is not int or now < 0 or type(evidence) is not dict:
        return denied("untrusted_receipt")
    if set(evidence) != GATES:
        return denied("missing_or_extra_evidence")

    identifiers = set()
    for gate in sorted(GATES):
        item = evidence[gate]
        if type(item) is not dict or set(item) != EVIDENCE_FIELDS:
            return denied("unknown_evidence")
        receipt_id = item["receipt_id"]
        observed = item["observed_tick"]
        if (item["state"] != "SIMULATED" or type(receipt_id) is not str
                or not re.fullmatch(r"fixture:[a-z0-9_]+", receipt_id)
                or type(observed) is not int or observed < 0
                or type(item["revoked"]) is not bool
                or type(item["replayed"]) is not bool):
            return denied("unknown_evidence")
        if (item["revoked"] or item["replayed"] or observed > now
                or now - observed > 60 or receipt_id in identifiers):
            return denied("stale_revoked_or_replayed")
        identifiers.add(receipt_id)

    # Deliberately no LIVE/VALIDADO path, even when all fake checks pass.
    return {"decision": "NO_GO", "synthetic_complete": True,
            "reason": "fictional_evidence_owner_not_granted"}


class BridgeLiveReadinessPreviewTests(unittest.TestCase):
    def test_missing_evidence_remains_no_go(self) -> None:
        positive = load_fixture()
        self.assertEqual(evaluate_preview(positive), {
            "decision": "NO_GO", "synthetic_complete": True,
            "reason": "fictional_evidence_owner_not_granted",
        })
        scenarios = (
            lambda x: x["evidence"].pop("e2e_133"),
            lambda x: x["evidence"]["security_219"].update(state="UNKNOWN"),
            lambda x: x["evidence"]["safari_122"].update(observed_tick=1),
            lambda x: x["evidence"]["consent_d061"].update(revoked=True),
            lambda x: x["evidence"]["rollback"].update(replayed=True),
            lambda x: x["evidence"]["rollback"].update(
                receipt_id=x["evidence"]["e2e_133"]["receipt_id"]),
            lambda x: x["evidence"]["e2e_133"].update(observed_tick=501),
        )
        for mutate in scenarios:
            candidate = copy.deepcopy(positive)
            mutate(candidate)
            with self.subTest(mutate=mutate.__code__.co_firstlineno):
                outcome = evaluate_preview(candidate)
                self.assertEqual(outcome["decision"], "NO_GO")
                self.assertFalse(outcome["synthetic_complete"])
        self.assertEqual(evaluate_preview(None)["decision"], "NO_GO")

    def test_owner_gate_not_replaced_by_ci(self) -> None:
        valid = load_fixture()
        mutations = (
            {"decision": "LIVE"},
            {"decision": "VALIDADO"},
            {"mode": "LIVE"},
            {"owner_gate": "APPROVED"},
            {"owner_gate": "CI_SUCCESS"},
            {"owner_gate": True},
            {"release_status": "VALIDADO"},
            {"now_tick": True},
        )
        for change in mutations:
            candidate = copy.deepcopy(valid)
            candidate.update(change)
            with self.subTest(change=change):
                result = evaluate_preview(candidate)
                self.assertEqual(result["decision"], "NO_GO")
                self.assertFalse(result["synthetic_complete"])
        source = DOC.read_text(encoding="utf-8")
        for required in (
            "NO_ACTIVAR_BRIDGE", "D-061", "ControlBot#20",
            "#133", "#219", "#122", "OWNER", "rollback", "consentimiento",
            "NO-GO", "#134", "#1", "sin red",
        ):
            with self.subTest(required=required):
                self.assertIn(required, source)
        self.assertNotRegex(source, r"(?mi)^Estado real:\s*(?:LIVE|VALIDADO)\s*$")

    def test_required_validate_really_executes_the_new_suite(self) -> None:
        scripts = json.loads(PACKAGE.read_text(encoding="utf-8"))["scripts"]
        command = "python3 -m unittest -v tests.test_bridge_live_readiness_preview"
        self.assertEqual(scripts["test"].count(command), 1)
        self.assertTrue(scripts["test"].endswith(" && " + command))
        workflow = VALIDATE.read_text(encoding="utf-8")
        self.assertIn("name: Validate / Pruebas y smoke Chrome", workflow)
        self.assertIn("- run: npm test", workflow)
        self.assertIn("npm ci --ignore-scripts", workflow)
        self.assertNotIn("continue-on-error", workflow)


if __name__ == "__main__":
    unittest.main()
