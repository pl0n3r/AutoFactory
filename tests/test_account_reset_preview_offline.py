"""AutoFactory #424 / #423-A: reset ficticio OFF, sin datos de cuenta."""
from __future__ import annotations
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "factory-control-account-status-preview.js"
SAFARI = ROOT / "safari/ChatGPT Autopilot Local Extension/Resources"
HTML = ROOT / "popup.html"
NOW = 1_800_000_000_000
WEEK = 7 * 24 * 60 * 60 * 1000


def sample(now=NOW, reset=NOW + 120_000, kind="limit"):
    return {"kind": kind, "observedAt": now - 5000,
            "validUntil": now + 20_000,
            "resetAt": reset if kind == "limit" else None}


def call(fixture=None, now=NOW, render=False):
    runner = """
      const api = require('./factory-control-account-status-preview.js');
      const x = JSON.parse(process.argv[1]);
      let result;
      if (x.render) {
        const outputs = {};
        const doc = {getElementById(id) {
          if (!outputs[id]) outputs[id] = {textContent:''};
          return outputs[id];
        }};
        api.render(doc, () => x.now);
        result = Object.fromEntries(
          Object.entries(outputs).map(([key, node]) => [key, node.textContent]));
      } else {
        const evaluation = api.evaluate(x.fixture, x.now);
        result = {evaluation, remaining:api.remainingResetLabel(evaluation,x.now)};
      }
      process.stdout.write(JSON.stringify(result));
    """
    r = subprocess.run(["node", "-e", runner, json.dumps(
        {"fixture": fixture, "now": now, "render": render})],
        cwd=ROOT, text=True, capture_output=True, check=True, timeout=10)
    return json.loads(r.stdout)


class AccountResetPreviewOfflineTests(unittest.TestCase):
    def test_fresh_synthetic_limit_shows_bounded_reset_duration(self):
        self.assertEqual("reinicio en 2 min", call(sample())["remaining"])
        self.assertEqual("reinicio en 1 min", call(sample(reset=NOW + 1))["remaining"])
        self.assertEqual("reinicio en 10080 min", call(sample(reset=NOW + WEEK))["remaining"])
        output = call(render=True)
        self.assertEqual(
            "LIMITADO · ejemplo fresco · reinicio en 2 min · SIMULACIÓN · OFF",
            output["account-status-preview-limit"])
        self.assertEqual(
            "REQUIERE_LOGIN · ejemplo fresco · SIMULACIÓN · OFF",
            output["account-status-preview-login"])
        self.assertIn("UNKNOWN", output["account-status-preview-unknown"])
        self.assertNotIn("reinicio en", output["account-status-preview-login"])

    def test_missing_stale_expired_ambiguous_or_bad_clock_fails_unknown(self):
        good = sample()
        invalid = [
            None, {}, [], {"kind": "limit"},
            {**good, "resetAt": None}, {**good, "resetAt": NOW},
            {**good, "resetAt": NOW - 1},
            {**good, "resetAt": NOW + WEEK + 1},
            {**good, "resetAt": "tomorrow"},
            {**good, "resetAt": NOW + 120_000.5},
            {**good, "observedAt": NOW - 60_001},
            {**good, "validUntil": NOW},
            {**good, "validUntil": NOW + 60_001},
            {**good, "personalData": "never"},
        ]
        for fixture in invalid:
            with self.subTest(fixture=str(fixture)[:75]):
                result = call(fixture)
                self.assertEqual("UNKNOWN", result["evaluation"]["code"])
                self.assertIsNone(result["remaining"])
        for now in (-1, 0, NOW + 0.5, "invalid", None):
            with self.subTest(now=now):
                result = call(now=now, render=True)
                self.assertEqual(
                    "UNKNOWN · sin evidencia · SIMULACIÓN · OFF",
                    result["account-status-preview-limit"])
        login = call(sample(kind="requires_login"))
        self.assertEqual("REQUIERE_LOGIN", login["evaluation"]["code"])
        self.assertIsNone(login["remaining"])

    def test_never_reads_real_account_or_sends_network_or_login(self):
        source = SOURCE.read_text()
        for forbidden in (
            "fetch(", "XMLHttpRequest", "WebSocket", "sendMessage(",
            "postMessage(", "chrome.", "browser.", "localStorage",
            "sessionStorage", "storage.", "document.cookie", "innerHTML",
            "addEventListener(", "setTimeout(", "setInterval(", "navigator.",
            "http://", "https://", "LISTO"
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)
        card = HTML.read_text().split('id="account-status-preview"', 1)[1].split("</section>", 1)[0]
        for control in ("<button", "<input", "<select"):
            self.assertNotIn(control, card)
        self.assertIn("SIMULACIÓN · OFF", card)

    def test_chrome_safari_parity_and_accessible_read_only_text(self):
        self.assertEqual(SOURCE.read_bytes(), (SAFARI / SOURCE.name).read_bytes())
        self.assertEqual(HTML.read_bytes(), (SAFARI / HTML.name).read_bytes())
        html = HTML.read_text()
        self.assertEqual(1, html.count('<script src="factory-control-account-status-preview.js"></script>'))
        for kind in ("limit", "login", "unknown"):
            self.assertEqual(1, html.count('id="account-status-preview-' + kind + '"'))
        card = html.split('id="account-status-preview"', 1)[1].split("</section>", 1)[0]
        self.assertEqual(3, card.count('aria-live="polite"'))
        attestation = (ROOT / "scripts/release-artifact-attestation.cjs").read_text()
        self.assertIn("'factory-control-account-status-preview.js'", attestation)
        attestation_test = (ROOT / "tests/test_release_artifact_attestation.py").read_text()
        self.assertIn('"factory-control-account-status-preview.js"', attestation_test)
        scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
        self.assertEqual(1, scripts["test"].count(
            "python3 -m unittest -v tests.test_account_reset_preview_offline"))


if __name__ == "__main__":
    unittest.main()
