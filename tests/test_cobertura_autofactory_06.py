"""AutoFactory #396: README real behavior, with B/C/D rows explicitly classified.

Only offline code tests run. The suite never proves installation, release
provenance, a GitHub snapshot or a live ControlBot bridge.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
OFFLINE = frozenset({
    "README-02-01", "README-04-01", "README-04-02", "README-04-03",
    "README-05-02", "README-05-03", "README-06-01", "README-06-02",
})
EXTERNAL = {
    "README-01-02": "GitHub release/tag and installed package provenance",
    "README-01-05": "real Safari/Xcode installation smoke #122",
    "README-03-01": "authenticated GitHub issues/PRs inventory",
    "README-03-03": "current GitHub dependency, claim and NEXT queue",
    "README-03-05": "live GitHub blocked issues and required checks",
}
DECLARATIVE = {
    "README-01-03": "ControlBot URL is a reference to an external console",
    "README-01-04": "description of an inert link, not a pairing API",
    "README-02-02": "CHANGELOG citation is historical documentation",
    "README-02-03": "D-061 is a human legal authority boundary",
    "README-03-02": "source-of-truth policy for GitHub, not executable state",
    "README-03-04": "LATER is backlog documentation, not runtime behavior",
    "README-05-01": "Factory/ControlBot/FactoryRunner roles are governance",
}
ABSENT = {}  # No absent production function is falsely counted as tested.
EXPECTED = OFFLINE | EXTERNAL.keys() | DECLARATIVE.keys() | ABSENT.keys()

NODE = r"""
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const child = require('node:child_process');
const core = require('./autopilot-core.js');
const recovery = require('./adaptive-recovery.js');
const activation = require('./factory-control-activation.js');
const {buildReadinessReport} = require('./factory-control-readiness-report.js');
const NOW = 1800000000000;
const ids = [];
const record = id => ids.push(id);
const doc = (text, editable = false) => ({
 nodeType: 0, body: {textContent: text},
 querySelector: selector => editable && selector === '#prompt-textarea'
   ? {id:'prompt-textarea'} : null, querySelectorAll: () => []
});
const signals = (observedAt=NOW-1000) => ({
 pairing: {state:'paired',observedAt},
 heartbeat:{state:'online',observedAt},
 orders:{state:'ready',observedAt},
 account:{state:'ready',observedAt}
});
const pairing = {profileAlias:'fixture',id:'fixture-pair-001',
 expiresAt:NOW+60000,revoked:false};
const consent = {profileAlias:'fixture',purpose:'heartbeat',
 enabled:true,revoked:false,expiresAt:NOW+60000};
const preflight = (legal = null, pair = pairing, agree = consent) =>
 activation.createActivationPreflight({
  loadVerifiedPairing: async () => pair,
  loadVerifiedHeartbeatConsent: async () => agree,
  loadVerifiedLegalGate: async () => legal,
  now: () => NOW
 });
async function main() {
 const mode = process.argv[1];
 if (mode === 'principal') {
  // README-02-01: recover only a genuinely failed conversation.
  assert.equal(core.conversationLoadFailed(doc('No se pudo cargar esta conversación')),true);
  assert.equal(core.conversationLoadFailed(doc('Unable to load this conversation')),true);
  record('README-02-01');

  // README-04-01: no composer means no eligible send control.
  assert.equal(core.composer(doc('Página sin editor')),null);
  assert.equal(core.sendButton(doc('Página sin editor')),null);
  record('README-04-01');

  // README-04-02: real adaptive recovery with deterministic synthetic policy.
  const policy = {enabled:true,expiresAt:NOW+60000,policyVersion:1,
   contexts:{'offline:page':{action:'retry',samples:30,confidence:0.95}}};
  assert.equal(recovery.chooseRecovery({problemCode:'offline',interfaceState:'page',
   defaults:{action:'wait'},policy,mode:'enforce',now:NOW}).action,'retry');
  record('README-04-02');

  // README-04-03: diagnostic-only readiness cannot activate a bridge.
  const state=buildReadinessReport(signals(),{nowMs:NOW});
  assert.equal(state.ready,true);
  assert.equal(state.mode,'offline_diagnostic_only');
  record('README-04-03');

  // README-05-02: manifest V3 and Safari resource manifest share version.
  const chrome=JSON.parse(fs.readFileSync('./manifest.json','utf8'));
  const safari=JSON.parse(fs.readFileSync(
   './safari/ChatGPT Autopilot Local Extension/Resources/manifest.json','utf8'));
  assert.equal(chrome.manifest_version,3);
  assert.equal(safari.manifest_version,3);
  assert.equal(chrome.version,safari.version);
  record('README-05-02');

  // README-05-03: real bridge preflight blocks absent legal authority.
  assert.deepEqual(await preflight().evaluate({profileAlias:'fixture'}),
   {allowed:false,code:'legal_blocked'});
  record('README-05-03');

  // README-06-01: require real, byte-identical JS protocol on both platforms.
  const left=fs.readFileSync('./factory-control-protocol.js','utf8');
  const right=fs.readFileSync(
   './safari/ChatGPT Autopilot Local Extension/Resources/factory-control-protocol.js','utf8');
  assert.equal(left,right);
  const chromeProtocol=require('./factory-control-protocol.js');
  const safariProtocol=require('./safari/ChatGPT Autopilot Local Extension/Resources/factory-control-protocol.js');
  assert.deepEqual(Object.keys(chromeProtocol).sort(),Object.keys(safariProtocol).sort());
  record('README-06-01');

  // README-06-02: real Node syntax checks, no install, network, or npm mutation.
  for (const name of ['autopilot-core.js','adaptive-recovery.js']) {
   child.execFileSync(process.execPath,['--check',name],
    {cwd:process.cwd(),stdio:'pipe'});
  }
  record('README-06-02');
 } else if (mode === 'negatives') {
  assert.equal(core.conversationLoadFailed(doc('Conversación sana')),false);
  assert.equal(core.conversationLoadFailed(
   doc('No se pudo cargar esta conversación',true)),false);
  assert.equal(core.sendButton(doc('Sin formulario')),null);
  assert.equal(recovery.chooseRecovery({problemCode:'offline',interfaceState:'page',
   defaults:{action:'wait'},mode:'enforce',isResponding:true,now:NOW}).action,'wait');
  assert.equal(recovery.chooseRecovery({problemCode:'offline',interfaceState:'page',
   defaults:{action:'wait'},mode:'enforce',now:NOW}).action,'wait');
  const stale=buildReadinessReport(signals(NOW-500000),{nowMs:NOW});
  assert.equal(stale.ready,false);
  assert.equal(stale.signals.account.state,'UNKNOWN');
  assert.equal(buildReadinessReport({}, {nowMs:NOW}).ready,false);
  assert.deepEqual(await preflight(null,null).evaluate({profileAlias:'fixture'}),
   {allowed:false,code:'unpaired'});
  assert.deepEqual(await preflight(null,pairing,null).evaluate({profileAlias:'fixture'}),
   {allowed:false,code:'consent_denied'});
  assert.deepEqual(await preflight().evaluate({profileAlias:'invalid@alias'}),
   {allowed:false,code:'invalid'});
  assert.deepEqual(await preflight().evaluate({profileAlias:'fixture'}),
   {allowed:false,code:'legal_blocked'});
  record('DENIED');
 } else {throw new Error('unsupported test mode');}
 console.log(JSON.stringify({verified:ids,production:'UNKNOWN',network:'disabled'}));
}
main().catch(() => {console.error('Offline assertions failed');process.exitCode=1;});
"""

def matrix_ids(source: str) -> set[str]:
    """No duplicated, malformed or falsely green README rows."""
    found: set[str] = set()
    for line in source.splitlines():
        if not line.startswith("| README-"):
            continue
        fields = [p.strip() for p in line.strip().strip("|").split("|")]
        key = fields[0].split(" · ", 1)[0]
        if len(fields) != 5 or not re.fullmatch(r"README-\d{2}-\d{2}", key):
            raise ValueError("UNKNOWN: invalid matrix row")
        if key in found:
            raise ValueError("UNKNOWN: duplicate matrix row")
        if fields[2] != "NO_VERIFICABLE":
            raise ValueError("UNKNOWN: invalid evidence state")
        found.add(key)
    return found

def node_case(mode: str) -> dict:
    if mode not in {"principal", "negatives"}:
        raise ValueError("unsupported synthetic test")
    node = shutil.which("node")
    if not node:
        raise AssertionError("UNKNOWN: Node.js unavailable")
    env = {k: os.environ[k] for k in ("PATH", "LANG", "LC_ALL") if k in os.environ}
    result = subprocess.run(
        [node, "-e", NODE, mode], cwd=ROOT, env=env,
        capture_output=True, text=True, timeout=35, check=False,
    )
    if result.returncode:
        raise AssertionError("UNKNOWN: JS behavior failure: " + result.stderr[-600:])
    try:
        return json.loads(result.stdout.strip())
    except json.JSONDecodeError as error:
        raise AssertionError("UNKNOWN: invalid JS evidence") from error

class CoberturaAutofactory06Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        self.assertEqual(20, len(EXPECTED))
        self.assertEqual(8, len(OFFLINE))
        self.assertTrue(EXPECTED.issubset(matrix_ids(MATRIX.read_text(encoding="utf-8"))))
        evidence = node_case("principal")
        self.assertEqual(OFFLINE, set(evidence["verified"]))
        self.assertEqual("UNKNOWN", evidence["production"])
        self.assertEqual("disabled", evidence["network"])
        self.assertTrue(EXTERNAL and DECLARATIVE)
        self.assertFalse(ABSENT)

    def test_falla_cerrado(self) -> None:
        evidence = node_case("negatives")
        self.assertEqual(["DENIED"], evidence["verified"])
        self.assertEqual("UNKNOWN", evidence["production"])
        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
            matrix_ids("| README-04-01 · README.md | x | NO_VERIFICABLE | y | z |\n"
                       "| README-04-01 · README.md | x | NO_VERIFICABLE | y | z |")
        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
            matrix_ids("| README-04-01 | malformed |")
        with self.assertRaises(ValueError):
            node_case("production")

    def test_sin_datos_reales(self) -> None:
        self.assertEqual(set(EXPECTED), set(OFFLINE) | set(EXTERNAL) | set(DECLARATIVE))
        self.assertTrue(all(value for value in (*EXTERNAL.values(), *DECLARATIVE.values())))
        own = Path(__file__).read_text(encoding="utf-8")
        self.assertNotRegex(own, r"-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----")
        self.assertNotRegex(own, r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
        self.assertNotIn("node" + "-fetch", own)
        self.assertNotIn("https:" + "//api.", own)
        self.assertEqual("UNKNOWN", node_case("principal")["production"])

if __name__ == "__main__":
    unittest.main()
