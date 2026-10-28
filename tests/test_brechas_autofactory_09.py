"""#316: five documentation coverage gaps tested only with offline fixtures.

Never claim authenticated observer cycles, browser installation, real provider
sessions, consent, live or production based on an offline acceptance test.
"""
from __future__ import annotations
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
UNKNOWN = "UNKNOWN"
GAPS = {
    "DOC-EXTENSION-SOURCE-PREFLIGHT-01":
        ("docs/extension-source-preflight.md", "manifest.json",
         "tests/test_safari_project_bundle.py", "Preflight estático de fuentes de extensión"),
    "DOC-OBSERVADOR-RESERVAS-V3-01":
        ("docs/OBSERVADOR-RESERVAS-V3.md",
         ".github/workflows/observador-reservas-consumidor.yml",
         "tests/test_observador_reservas_consumidor.py", "Alcance y seguridad"),
    "DOC-OBSERVADOR-RESERVAS-V3-02":
        ("docs/OBSERVADOR-RESERVAS-V3.md",
         ".github/workflows/observador-reservas-consumidor.yml",
         "tests/test_observador_reservas_consumidor.py",
         "Criterios operativos que aún NO se acreditan"),
    "DOC-OBSERVADOR-RESERVAS-V3-03":
        ("docs/OBSERVADOR-RESERVAS-V3.md",
         ".github/workflows/observador-reservas-consumidor.yml",
         "tests/test_observador_reservas_consumidor.py", "Validación y reversión"),
    "DOC-OFFLINE-SESSION-STATE-DENIALS-01":
        ("docs/OFFLINE-SESSION-STATE-DENIALS.md",
         "factory-control-account-state.js",
         "tests/test_offline_session_state_denials.py", "Autoridad y alcance"),
}

NODE_SCENARIOS = r"""
'use strict';
const api = require('./factory-control-account-state.js');
const now = () => 10000;
const base = {authenticated:true, usageLimited:false, providerError:false, resetAt:null};
const states = {
 ready:api.classifyAccountState(base,now).state,
 limit:api.classifyAccountState({...base,usageLimited:true},now).state,
 extra:api.classifyAccountState({...base,chatText:'fixture-only'},now).state,
 inconsistent:api.classifyAccountState({...base,usageLimited:true,providerError:true},now).state,
 invalid:api.classifyProviderPageSignal({signalCode:'unexpected',alertText:null},now).state
};
const signal = (at, extra={})=>({signalCode:'ready',alertText:null,observedAt:at,...extra});
const probe = (value)=>api.createProviderAccountStateObserver({
 now, maxAgeMs:1000, readProviderSignal:async()=>value
}).read();
Promise.all([
 probe(signal(9999)), probe(signal(8999)), probe(signal(10001)),
 probe(signal(9999,{conversationId:'fixture-only'})), probe(null)
]).then(samples=>process.stdout.write(JSON.stringify({states,samples})))
  .catch(()=>{process.exitCode=1});
"""


def extract_rows(document: str) -> dict:
    """Missing, malformed, duplicate, and unrecognized statuses fail closed."""
    found = {}
    for line in document.splitlines():
        if not line.startswith("| DOC-"):
            continue
        first = line.split("|", 2)[1].strip()
        key = first.split(" · ", 1)[0]
        if key not in GAPS:
            continue
        fields = [value.strip() for value in line.strip().strip("|").split("|")]
        if len(fields) != 6 or not all(fields) or key in found:
            raise ValueError(f"UNKNOWN: duplicate or malformed {key}")
        if first != f"{key} · {GAPS[key][0]}":
            raise ValueError(f"UNKNOWN: unexpected source for {key}")
        if fields[2] not in {"NO_VERIFICABLE", "EN_CURSO", "CUBIERTO",
                             "SIN_COBERTURA", "DESCARTADO"}:
            raise ValueError(f"UNKNOWN: invalid status {key}")
        found[key] = tuple(fields[1:5])
    if set(found) != set(GAPS):
        raise ValueError("UNKNOWN: missing DOC gap rows")
    return found


def observer_contract(source: str) -> bool:
    """Observe exact read-only caller policy; no workflow execution."""
    scopes = re.findall(
        r"(?m)^(  |      )(contents|issues|pull-requests|checks|actions): (\w+)$",
        source,
    )
    allowed = {"contents", "issues", "pull-requests", "checks", "actions"}
    return all((
        len(re.findall(r"(?m)^on:$", source)) == 1,
        "cron: '*/10 * * * *'" in source,
        "  workflow_dispatch:" in source,
        len(re.findall(r"(?m)^jobs:$", source)) == 1,
        len(re.findall(r"(?m)^  observe:$", source)) == 1,
        source.count("uses: pl0n3r/Factory/.github/workflows/observador-reservas-consumidor.yml@v1") == 1,
        len(scopes) == 10,
        {name for indent, name, mode in scopes if indent == "  " and mode == "read"} == allowed,
        {name for indent, name, mode in scopes if indent == "      " and mode == "read"} == allowed,
        "group: lease-consumer-caller-" in source,
        "cancel-in-progress: false" in source,
        not re.search(r"(?m)^\s*(?:secrets:|run:|steps:|env:|with:|[a-z-]+: write$)", source),
        not re.search(r"(?m)^  (?:push|pull_request|issue_comment|workflow_run):$", source),
    ))


def synthetic_states() -> dict:
    node = shutil.which("node")
    if node is None:
        raise AssertionError("UNKNOWN: Node not available")
    result = subprocess.run([node, "-e", NODE_SCENARIOS], cwd=ROOT,
                            text=True, capture_output=True, check=False, timeout=20)
    if result.returncode:
        raise AssertionError("UNKNOWN: synthetic JS failed: " + result.stderr[-700:])
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise AssertionError("UNKNOWN: unreadable JS evidence") from error


def operational_evidence(candidate: object = None) -> str:
    """No authenticated external evidence exists inside this local test."""
    return UNKNOWN


class BrechasAutofactory09Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = extract_rows(MATRIX.read_text(encoding="utf-8"))
        cls.caller = (ROOT / GAPS["DOC-OBSERVADOR-RESERVAS-V3-01"][1]).read_text(
            encoding="utf-8")
        cls.signals = synthetic_states()

    def test_contrato_principal(self):
        """AC-01: five individual rows, preflight, observer, session denials."""
        self.assertEqual(set(self.rows), set(GAPS))
        for key, (document, source, previous, heading) in GAPS.items():
            with self.subTest(clause=key):
                _, status, evidence, _ = self.rows[key]
                self.assertIn(status, {"NO_VERIFICABLE", "EN_CURSO", "CUBIERTO"})
                self.assertIn(chr(96) + source + chr(96), evidence)
                self.assertIn(chr(96) + previous + chr(96), evidence)
                self.assertIn("UNKNOWN", evidence)
                self.assertIn(heading, (ROOT / document).read_text(encoding="utf-8"))
                self.assertTrue((ROOT / source).is_file())
                self.assertTrue((ROOT / previous).is_file())
                self.assertEqual(operational_evidence(self.rows[key]), UNKNOWN)
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["host_permissions"], ["https://chatgpt.com/*"])
        self.assertEqual(set(manifest["permissions"]),
                         {"activeTab", "alarms", "storage", "tabs"})
        self.assertIn("node scripts/verify-extension-assets.cjs",
                      (ROOT / "docs/extension-source-preflight.md").read_text())
        node = shutil.which("node")
        self.assertIsNotNone(node)
        check = subprocess.run([node, "scripts/verify-extension-assets.cjs"],
                               cwd=ROOT, text=True, capture_output=True,
                               check=False, timeout=30)
        self.assertEqual(check.returncode, 0, check.stderr[-500:])
        self.assertTrue(observer_contract(self.caller))
        doc = (ROOT / "docs/OBSERVADOR-RESERVAS-V3.md").read_text()
        for marker in ("24 horas", "100 ciclos", "Fase B continúa desactivada",
                       "revertir el PR"):
            self.assertIn(marker, doc)
        self.assertEqual(self.signals["states"], {
            "ready": "ready", "limit": "limit", "extra": "unknown",
            "inconsistent": "unknown", "invalid": "unknown"})
        self.assertEqual([x["state"] for x in self.signals["samples"]],
                         ["ready", "unknown", "unknown", "unknown", "unknown"])

    def test_falla_cerrado(self):
        """AC-02: absent or ambiguous proof must not be accepted."""
        doc = MATRIX.read_text(encoding="utf-8")
        row = next(x for x in doc.splitlines()
                   if x.startswith("| DOC-EXTENSION-SOURCE-PREFLIGHT-01 ·"))
        for damaged in (doc.replace(row, ""), doc + "\n" + row,
                        doc.replace(row, "| DOC-EXTENSION-SOURCE-PREFLIGHT-01 · broken |")):
            with self.assertRaises(ValueError):
                extract_rows(damaged)
        for damaged in (self.caller.replace("contents: read", "contents: write", 1),
                        self.caller.replace("cancel-in-progress: false",
                                            "cancel-in-progress: true"),
                        self.caller.replace("@v1", "@main"),
                        self.caller + "\n  push:\n"):
            self.assertFalse(observer_contract(damaged))
        self.assertEqual(self.signals["samples"][1]["freshness"], "stale")
        self.assertEqual(operational_evidence({"workflow": "success"}), UNKNOWN)

    def test_sin_datos_reales(self):
        """AC-03: fake signals, no PII or external network access."""
        fixture = json.dumps({"authenticated": True, "usageLimited": False,
                              "providerError": False, "resetAt": None})
        self.assertNotIn("@", fixture)
        self.assertNotIn("://", fixture)
        self.assertNotRegex(fixture, r"(?i)bearer\s|password|sk-[a-z0-9]+")
        for unsafe in ("fetch(", "https.request", "http.request", "child_process"):
            self.assertNotIn(unsafe, NODE_SCENARIOS)
        for result in self.signals["samples"]:
            self.assertEqual(set(result), {"state", "resetAt", "observedAt", "freshness"})
            self.assertNotIn("conversationId", result)

    def test_estados_unknown_explicitos(self):
        """AC-04: online readiness remains UNKNOWN despite synthetic successes."""
        self.assertEqual(set(self.rows), set(GAPS))
        for key, (_, status, evidence, _) in self.rows.items():
            with self.subTest(clause=key):
                self.assertEqual(status, "NO_VERIFICABLE")
                self.assertIn("Estado operativo: UNKNOWN", evidence)
                for simulated in (None, {}, {"ci": "success"},
                                  {"hours": 24, "cycles": 100},
                                  {"chrome": "installed", "safari": "installed"}):
                    self.assertEqual(operational_evidence(simulated), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
