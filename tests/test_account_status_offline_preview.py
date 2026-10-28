"""Contrato de la vista de cuenta sintética AutoFactory#302; cero red y PII."""
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "factory-control-account-status-preview.js"
HTML = ROOT / "popup.html"
SAFARI = ROOT / "safari/ChatGPT Autopilot Local Extension/Resources"
NOW = 1_800_000_000_000


def observe(fixture, now=NOW):
    runner = (
        "const view = require('./factory-control-account-status-preview.js');"
        "const x = JSON.parse(process.argv[1]);"
        "process.stdout.write(JSON.stringify(view.evaluate(x.fixture, x.now)));"
    )
    output = subprocess.check_output(
        ["node", "-e", runner, json.dumps({"fixture": fixture, "now": now})],
        cwd=ROOT, text=True, timeout=10,
    )
    return json.loads(output)


class AccountStatusOfflinePreviewTests(unittest.TestCase):
    def limit(self):
        return {"kind": "limit", "observedAt": NOW - 5000,
                "validUntil": NOW + 20_000, "resetAt": NOW + 120_000}

    def login(self):
        return {"kind": "requires_login", "observedAt": NOW - 5000,
                "validUntil": NOW + 20_000, "resetAt": None}

    def test_synthetic_rate_limit_without_provider_requests(self):
        result = observe(self.limit())
        self.assertEqual(result["code"], "LIMITADO")
        self.assertEqual(result["freshness"], "ejemplo fresco")
        source = SOURCE.read_text(encoding="utf-8")
        for prohibited in ("fetch(", "XMLHttpRequest", "sendMessage(",
                           "chrome.storage", "browser.storage", "innerHTML"):
            self.assertNotIn(prohibited, source)
        self.assertNotIn("READY", source)

    def test_closed_session_requires_login_without_login_actions(self):
        self.assertEqual(observe(self.login())["code"], "REQUIERE_LOGIN")
        self.assertIsNone(observe(self.login())["resetAt"])
        self.assertEqual(observe({**self.login(), "resetAt": NOW + 100})["code"], "UNKNOWN")
        html = HTML.read_text(encoding="utf-8")
        fragment = html.split('id="account-status-preview"', 1)[1].split("</section>", 1)[0]
        self.assertNotIn("<button", fragment)
        self.assertNotIn("<input", fragment)

    def test_unknown_default_and_no_sensitive_payload(self):
        bad = [None, {}, [], {**self.limit(), "email": "synthetic@example.test"},
               {**self.limit(), "observedAt": NOW + 1},
               {**self.limit(), "observedAt": NOW - 60_001},
               {**self.limit(), "validUntil": NOW},
               {**self.limit(), "resetAt": NOW - 1},
               {**self.login(), "kind": "ready"},
               {**self.login(), "validUntil": "tomorrow"}]
        for fixture in bad:
            with self.subTest(fixture=fixture):
                self.assertEqual(observe(fixture)["code"], "UNKNOWN")
                self.assertEqual(observe(fixture)["freshness"], "sin evidencia")
        self.assertEqual(observe(self.limit(), now=-1)["code"], "UNKNOWN")

    def test_chrome_safari_static_parity(self):
        self.assertEqual(SOURCE.read_bytes(), (SAFARI / SOURCE.name).read_bytes())
        self.assertEqual(HTML.read_bytes(), (SAFARI / HTML.name).read_bytes())
        html = HTML.read_text(encoding="utf-8")
        self.assertEqual(html.count('<script src="factory-control-account-status-preview.js"></script>'), 1)
        for name in ("limit", "login", "unknown"):
            self.assertIn('id="account-status-preview-' + name + '"', html)
        self.assertIn("SIMULACIÓN · OFF", html)
        script = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]["test"]
        self.assertEqual(script.count("python3 -m unittest -v tests.test_account_status_offline_preview"), 1)


if __name__ == "__main__":
    unittest.main()
