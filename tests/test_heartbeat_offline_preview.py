"""AutoFactory #388: preview sintético de heartbeat, sin proveedor, red ni PII."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "factory-control-heartbeat-preview.js"
HTML = ROOT / "popup.html"
SAFARI = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"
ATTESTATION = ROOT / "scripts" / "release-artifact-attestation.cjs"
PACKAGE = ROOT / "package.json"
NOW = 1_800_000_000_000


def evaluate(fixture, now=NOW, previous=0):
    runner = (
        "const api = require('./factory-control-heartbeat-preview.js');"
        "const args = JSON.parse(process.argv[1]);"
        "process.stdout.write(JSON.stringify(api.evaluate(args.fixture,args.now,args.previous)));"
    )
    result = subprocess.run(
        ["node", "-e", runner, json.dumps({"fixture": fixture, "now": now, "previous": previous})],
        cwd=ROOT, capture_output=True, text=True, timeout=10, check=True,
    )
    return json.loads(result.stdout)


def fixture(state, age, misses, seq, observed_at=NOW):
    return {"scope": "synthetic-only", "state": state, "observedAt": observed_at,
            "lastConfirmedAt": NOW - age, "missedIntervals": misses, "sequence": seq}


class HeartbeatOfflinePreviewTests(unittest.TestCase):
    def test_fixture_fresh_stale_offline_without_network(self):
        scenarios = (("online", 5000, 0, 1, "ONLINE", 5),
                     ("stale", 90000, 1, 2, "STALE", 90),
                     ("offline", 240000, 3, 3, "OFFLINE", 240))
        for name, age, misses, seq, status, seconds in scenarios:
            with self.subTest(state=name):
                result = evaluate(fixture(name, age, misses, seq))
                self.assertEqual(status, result["state"])
                self.assertEqual(seconds, result["ageSeconds"])
                self.assertIn("ficticio", result["reason"])
        self.assertEqual("UNKNOWN", evaluate(None)["state"])

    def test_expired_missing_ambiguous_timestamp_is_unknown(self):
        good = fixture("online", 5000, 0, 1)
        invalid = [None, {}, [], {**good, "scope": "real"},
                   {**good, "state": "ready"}, {**good, "observedAt": NOW + 1},
                   {**good, "observedAt": NOW - 60001},
                   {**good, "lastConfirmedAt": None},
                   {**good, "lastConfirmedAt": NOW + 1},
                   {**good, "lastConfirmedAt": "today"},
                   {**good, "lastConfirmedAt": NOW - 61000},
                   {**good, "missedIntervals": 1}, {**good, "sequence": 0},
                   {**good, "sequence": "2"},
                   {**good, "email": "fake@example.test"},
                   fixture("stale", 90000, 3, 2),
                   fixture("offline", 90000, 3, 3),
                   fixture("stale", 240000, 1, 2)]
        for candidate in invalid:
            with self.subTest(case=str(candidate)[:100]):
                self.assertEqual("UNKNOWN", evaluate(candidate)["state"])
        self.assertEqual("UNKNOWN", evaluate(good, previous=1)["state"])
        self.assertEqual("UNKNOWN", evaluate(good, now=-1)["state"])
        self.assertEqual("UNKNOWN", evaluate(good, previous=-1)["state"])

    def test_never_emits_heartbeat_or_sensitive_payload(self):
        source = SOURCE.read_text(encoding="utf-8")
        forbidden = ("fetch(", "XMLHttpRequest", "WebSocket", "sendMessage(",
                     "chrome.", "browser.", ".storage", "localStorage",
                     "document.cookie", "innerHTML", "addEventListener(",
                     "navigator.", "http://", "https://")
        for needle in forbidden:
            with self.subTest(needle=needle):
                self.assertNotIn(needle, source)
        self.assertEqual("UNKNOWN", evaluate({**fixture("online", 5000, 0, 1),
                                               "password": "synthetic-secret"})["state"])
        self.assertNotIn("synthetic-secret", json.dumps(evaluate(None)))
        html = HTML.read_text(encoding="utf-8")
        card = html.split('id="heartbeat-offline-preview"', 1)[1].split("</section>", 1)[0]
        self.assertNotIn("<button", card)
        self.assertNotIn("<input", card)
        self.assertIn("SIMULACIÓN · OFF", card)
        self.assertIn('aria-live="polite"', card)

    def test_chrome_safari_static_parity(self):
        for relative in ("popup.html", "factory-control-heartbeat-preview.js"):
            with self.subTest(path=relative):
                self.assertEqual((ROOT / relative).read_bytes(), (SAFARI / relative).read_bytes())
        html = HTML.read_text(encoding="utf-8")
        script = '<script src="factory-control-heartbeat-preview.js"></script>'
        self.assertEqual(1, html.count(script))
        for name in ("online", "stale", "offline", "unknown"):
            self.assertEqual(1, html.count('id="heartbeat-offline-preview-' + name + '"'))
        self.assertIn("'factory-control-heartbeat-preview.js'", ATTESTATION.read_text(encoding="utf-8"))
        package = json.loads(PACKAGE.read_text(encoding="utf-8"))
        self.assertEqual(1, package["scripts"]["test"].count(
            "python3 -m unittest -v tests.test_heartbeat_offline_preview"))


if __name__ == "__main__":
    unittest.main()
