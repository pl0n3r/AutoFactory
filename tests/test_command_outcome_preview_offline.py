"""Regresiones de la vista inerte de resultados ficticios autorizada por #390/A."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "factory-control-command-outcome-preview.js"
HTML = ROOT / "popup.html"
SAFARI = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"
ATTESTATION = ROOT / "scripts" / "release-artifact-attestation.cjs"
ATTESTATION_TEST = ROOT / "tests" / "test_release_artifact_attestation.py"
PACKAGE = ROOT / "package.json"
NOW = 1_800_000_000_000


def fixture(code="ok", *, sequence=1, observed_at=NOW - 1000):
    return {"scope": "synthetic-only", "code": code,
            "observedAt": observed_at, "sequence": sequence}


def evaluate(value, now=NOW, previous=0):
    runner = (
        "const api = require('./factory-control-command-outcome-preview.js');"
        "const args = JSON.parse(process.argv[1]);"
        "process.stdout.write(JSON.stringify(api.evaluate(args.value,args.now,args.previous)));"
    )
    result = subprocess.run(
        ["node", "-e", runner, json.dumps({"value": value, "now": now, "previous": previous})],
        cwd=ROOT, capture_output=True, text=True, timeout=10, check=True,
    )
    return json.loads(result.stdout)


class CommandOutcomePreviewOfflineTests(unittest.TestCase):
    def test_renders_ok_failed_timeout_and_duplicate_from_fixtures(self):
        outcomes = [
            ("ok", "OK"), ("failed", "FAILED"), ("timeout", "TIMEOUT"),
            ("already_handled", "DUPLICATE"), ("unauthorized", "REJECTED"),
        ]
        for index, (code, state) in enumerate(outcomes, 1):
            with self.subTest(code=code):
                result = evaluate(fixture(code, sequence=index))
                self.assertEqual(result["state"], state)
                self.assertIn("SIMULACIÓN · OFF", result["label"])
        self.assertEqual("UNKNOWN", evaluate(None)["state"])

    def test_malformed_absent_or_sensitive_input_fails_closed(self):
        valid = fixture()
        invalid = [
            None, {}, [], "ok", {"code": "ok"}, {**valid, "scope": "real"},
            {**valid, "code": "execute"}, {**valid, "observedAt": NOW + 1},
            {**valid, "observedAt": NOW - 60001},
            {**valid, "observedAt": "now"}, {**valid, "sequence": 0},
            {**valid, "sequence": "1"}, {**valid, "sequence": 1.5},
            {**valid, "email": "private@example.test"},
            {**valid, "token": "not-a-real-secret"},
            {**valid, "message": "sensitive message"},
        ]
        for candidate in invalid:
            with self.subTest(candidate=str(candidate)[:85]):
                self.assertEqual("UNKNOWN", evaluate(candidate)["state"])
                self.assertNotIn("private@example.test", evaluate(candidate)["label"])
                self.assertNotIn("sensitive message", evaluate(candidate)["label"])
        self.assertEqual("UNKNOWN", evaluate(valid, previous=1)["state"])
        self.assertEqual("UNKNOWN", evaluate(valid, now=-1)["state"])
        self.assertEqual("UNKNOWN", evaluate(valid, previous=-1)["state"])

    def test_never_sends_command_message_or_network_requests(self):
        source = SOURCE.read_text(encoding="utf-8")
        forbidden = (
            "fetch(", "XMLHttpRequest", "WebSocket", "sendMessage(", "postMessage(",
            "chrome.", "browser.", "localStorage", ".storage", "document.cookie",
            "innerHTML", "addEventListener(", "navigator.", "http://", "https://",
            "eval(", "Function("
        )
        for needle in forbidden:
            with self.subTest(needle=needle):
                self.assertNotIn(needle, source)
        card = HTML.read_text(encoding="utf-8").split(
            'id="command-outcome-preview"', 1
        )[1].split("</section>", 1)[0]
        self.assertNotIn("<button", card)
        self.assertNotIn("<input", card)
        self.assertNotIn("<select", card)
        self.assertIn("SIMULACIÓN · OFF", card)
        self.assertIn("No ejecuta órdenes", card)

    def test_chrome_safari_static_parity_and_accessible_status(self):
        for relative in ("popup.html", "factory-control-command-outcome-preview.js"):
            with self.subTest(path=relative):
                self.assertEqual((ROOT / relative).read_bytes(), (SAFARI / relative).read_bytes())
        html = HTML.read_text(encoding="utf-8")
        self.assertEqual(1, html.count('<script src="factory-control-command-outcome-preview.js"></script>'))
        for name in ("ok", "failed", "timeout", "duplicate", "rejected", "unknown"):
            self.assertEqual(1, html.count('id="command-outcome-preview-' + name + '"'))
        card = html.split('id="command-outcome-preview"', 1)[1].split("</section>", 1)[0]
        self.assertEqual(6, card.count('role="status" aria-live="polite"'))
        self.assertIn("'factory-control-command-outcome-preview.js'", ATTESTATION.read_text(encoding="utf-8"))
        self.assertIn('"factory-control-command-outcome-preview.js"', ATTESTATION_TEST.read_text(encoding="utf-8"))
        package = json.loads(PACKAGE.read_text(encoding="utf-8"))
        self.assertEqual(1, package["scripts"]["test"].count(
            "python3 -m unittest -v tests.test_command_outcome_preview_offline"))


if __name__ == "__main__":
    unittest.main()
