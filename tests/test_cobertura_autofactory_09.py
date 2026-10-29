#!/usr/bin/env python3
"""#399: real offline extension contracts; never evidence of browser/live use.

The local Node subprocess executes committed JS with synthetic in-memory Chrome
storage and messages. B/C clauses require separate real-world or policy proof.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
A = frozenset(("README-13-04", "README-15-01", "README-15-02"))
OTHER = {
    "README-13-03": ("B", "Actual interrupted network and delayed reload need browser evidence"),
    "README-13-05": ("B", "DOM scrolling/manual pause need real Chrome/Safari observation"),
    "README-14-02": ("B", "Historical #246/#247 issue and PR status needs GitHub evidence"),
    "README-14-03": ("B", "Installed popup/badge behavior needs browser integration"),
    "README-15-03": ("B", "Real clipboard permissions and popup click need a browser UI"),
    "README-13-06": ("C", "Global privileged-action prohibition is a governance rule"),
    "README-14-01": ("C", "Missing runtime popup/badge wiring is a limitation"),
    "README-14-04": ("C", "Do not certify an unvalidated feature is a policy"),
    "README-15-04": ("C", "CHANGELOG is a historical documentation pointer"),
}
IDS = A | OTHER.keys()
UNKNOWN = "UNKNOWN"

NODE = r"""
'use strict';
const assert = require('node:assert/strict');
const reliability = require('./reliability.js');
const core = require('./autopilot-core.js');
const adaptive = require('./adaptive-recovery.js');
const tabProgress = require('./local-tab-progress.js');
const state = { diagnosticLog: [] };
let handler;
global.chrome = {
  storage: {local: {
    get(defaults, callback) { callback({...defaults, ...state}); },
    set(values, callback) { Object.assign(state, values); callback?.(); }
  }},
  runtime: {onMessage: {addListener(fn) { handler = fn; }}}
};
require('./background.js');
const send = (message, sender = {}) => new Promise((resolve, reject) => {
  try { handler(message, sender, resolve); }
  catch (_error) { reject(new Error('offline listener rejected')); }
});
const sender = {tab: {id: 17, windowId: 3,
  url: 'https://chatgpt.com/c/SYNTHETIC_ROUTE_SECRET'}};
const at = () => new Date().toISOString();

async function principal() {
  const tested = [], partial = [];
  // README-13-04: pending-send persistence, duplicate suppression,
  // genuine exponential backoff and circuit breaker.
  const values = new Map();
  const storage = {
    getItem: k => values.get(k) || null,
    setItem: (k, v) => values.set(k, v)
  };
  const digest = reliability.signature('fixture pending send');
  const saved = reliability.save(storage, {
    pendingSignature: digest, assistantCountBeforeSend: 2, lastSentAt: 500
  });
  assert.equal(saved.pendingSignature, reliability.load(storage).pendingSignature);
  assert.notEqual(saved.pendingSignature, 'fixture pending send');
  assert.equal(reliability.sendAccepted({
    composerCleared: false, messageAppeared: true, generationStarted: true
  }), false);
  let current = reliability.normalize();
  let prevRetry = 100000;
  for (let i = 0; i < 5; i += 1) {
    current = reliability.afterFailure(current, 100000);
    assert.ok(current.retryAt > prevRetry);
    prevRetry = current.retryAt;
  }
  assert.equal(current.consecutiveFailures, 5);
  assert.ok(current.circuitOpenUntil > 100000);
  assert.equal(reliability.canReload(current, 100000), false);
  assert.equal(reliability.afterSuccess(current).circuitOpenUntil, 0);
  current = reliability.normalize();
  for (let i = 0; i < 3; i += 1) current = reliability.beforeReload(current, 100000);
  assert.equal(reliability.canReload(current, 100000), false);
  tested.push('README-13-04');

  // Partial safety behaviors do NOT certify live network or a runtime popup.
  assert.equal(core.connectionRecoveryAction({generating:false}), 'wait');
  assert.equal(core.isSafeRecoverySignal({
    code:'authentication', action:'human', element:{}
  }), false);
  assert.equal(adaptive.chooseRecovery({
    problemCode:'network', interfaceState:'offline', mode:'off',
    defaults:{action:'wait'}
  }).action, 'wait');
  assert.equal(tabProgress.classifyTabProgress(null), 'UNKNOWN');
  partial.push('README-13-03', 'README-13-06', 'README-14-01');

  // README-15-01: exercise the real background message handler and retention.
  state.diagnosticLog = Array.from({length:310}, (_, i) => ({
    at: at(), event:'status', tabId:i, windowId:3,
    path:'/c/SYNTHETIC_ROUTE_SECRET',
    details:{code:'safe', message:'SYNTHETIC_PRIVATE_PAYLOAD'}
  }));
  state.diagnosticLog[0].at = '2000-01-01T00:00:00.000Z';
  await send({type:'autopilot:log', event:'failure', details:{
    code:'connection', attempt:2, message:'SYNTHETIC_PRIVATE_PAYLOAD',
    token:'SYNTHETIC_TOKEN'
  }}, sender);
  const log = await send({type:'autopilot:get-log'});
  assert.equal(log.entries.length, 300);
  assert.equal(log.entries.at(-1).tabId, 17);
  assert.equal(log.entries.at(-1).windowId, 3);
  assert.ok(log.entries.every(r => r.path === '/c/:id'));
  assert.ok(log.entries.every(r => r.at >= '2020'));
  tested.push('README-15-01');

  // README-15-02: sanitize both new and legacy chat paths/details.
  assert.deepEqual(log.entries.at(-1).details, {code:'connection', attempt:2});
  assert.equal(log.entries[0].details.message, undefined);
  const exported = JSON.stringify(log);
  for (const secret of ['SYNTHETIC_PRIVATE_PAYLOAD', 'SYNTHETIC_ROUTE_SECRET',
                        'SYNTHETIC_TOKEN', '"token"']) {
    assert.equal(exported.includes(secret), false);
  }
  tested.push('README-15-02');
  // Partial #15-03: actual get/clear operations, not real popup clipboard.
  assert.deepEqual(await send({type:'autopilot:clear-log'}), {ok:true});
  assert.deepEqual((await send({type:'autopilot:get-log'})).entries, []);
  partial.push('README-15-03');
  return {tested, partial, denied:[], operation:'UNKNOWN', network:'disabled'};
}
async function negatives() {
  const denied = [];
  assert.equal(reliability.load({getItem:()=>'{bad json'}).pendingSignature, '');
  denied.push('invalid-storage');
  assert.equal(reliability.sendAccepted({composerCleared:false,
    messageAppeared:true}), false);
  denied.push('ambiguous-send');
  const blocked = adaptive.chooseRecovery({
    problemCode:'authentication', interfaceState:'dialog',
    mode:'enforce', now:200, defaults:{action:'wait'},
    policy:{enabled:true, expiresAt:400, policyVersion:1,
      contexts:{'authentication:dialog':{action:'authorize',
        samples:50, confidence:1}}}
  });
  assert.equal(blocked.action, 'wait');
  denied.push('privileged-action');
  state.diagnosticLog = [{
    at:at(), event:'failure', tabId:-1, windowId:-2,
    path:'/c/SYNTHETIC_LEGACY_SECRET',
    details:{code:'unsafe/secret', message:'SYNTHETIC_PRIVATE_PAYLOAD',
      rawToken:'SYNTHETIC_TOKEN'}
  }];
  const log = await send({type:'autopilot:get-log'});
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].path, '/c/:id');
  assert.equal(log.entries[0].tabId, null);
  assert.deepEqual(log.entries[0].details, {});
  for (const secret of ['SYNTHETIC_LEGACY_SECRET', 'SYNTHETIC_PRIVATE_PAYLOAD',
                        'SYNTHETIC_TOKEN']) {
    assert.equal(JSON.stringify(log).includes(secret), false);
  }
  denied.push('legacy-privacy');
  assert.deepEqual(await send({type:'autopilot:clear-log'}), {ok:true});
  assert.deepEqual((await send({type:'autopilot:get-log'})).entries, []);
  denied.push('clear-local');
  return {tested:[], partial:[], denied, operation:'UNKNOWN', network:'disabled'};
}
const fn = process.argv[1] === 'principal' ? principal
  : process.argv[1] === 'negatives' ? negatives : null;
if (!fn) process.exitCode = 1;
else fn().then(r => process.stdout.write(JSON.stringify(r))).catch(() => {
  // Never echo raw exceptions from untrusted diagnostic data.
  process.stderr.write('synthetic local contract failed\n');
  process.exitCode = 1;
});
"""


def run_node(mode: str) -> dict:
    if mode not in ("principal", "negatives"):
        raise ValueError("UNKNOWN: unsupported mode")
    node = shutil.which("node")
    if node is None:
        raise AssertionError("UNKNOWN: Node.js required")
    env = {k: os.environ[k] for k in ("PATH", "LANG", "LC_ALL")
           if k in os.environ}
    proc = subprocess.run(
        [node, "-e", NODE, mode], cwd=ROOT, env=env,
        capture_output=True, text=True, timeout=35, check=False,
    )
    if proc.returncode:
        raise AssertionError("UNKNOWN: real JS offline test failed")
    try:
        value = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise AssertionError("UNKNOWN: unreadable JS evidence") from exc
    if not isinstance(value, dict):
        raise AssertionError("UNKNOWN: bad JS evidence")
    return value


class CoberturaAutofactory09Tests(unittest.TestCase):
    def test_contrato_principal(self):
        self.assertEqual(len(IDS), 12)
        self.assertEqual(len(A), 3)
        self.assertEqual(set(A) | set(OTHER), set(IDS))
        evidence = run_node("principal")
        self.assertEqual(set(evidence["tested"]), A)
        self.assertEqual(set(evidence["partial"]), {
            "README-13-03", "README-13-06", "README-14-01", "README-15-03"
        })
        self.assertEqual(evidence["operation"], UNKNOWN)
        self.assertEqual(evidence["network"], "disabled")
        self.assertTrue(all(kind in ("B", "C", "D") and reason
                            for kind, reason in OTHER.values()))

    def test_falla_cerrado(self):
        result = run_node("negatives")
        self.assertEqual(set(result["denied"]), {
            "invalid-storage", "ambiguous-send", "privileged-action",
            "legacy-privacy", "clear-local",
        })
        self.assertEqual(result["operation"], UNKNOWN)

    def test_sin_datos_reales(self):
        self.assertEqual(len(IDS), 12)
        self.assertNotRegex(NODE, r"\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(")
        self.assertNotRegex(NODE, r"require\(['\"](?:https?|net|tls|socket)")
        self.assertNotIn("https://" + "api.", NODE)
        result = run_node("principal")
        self.assertEqual(result["operation"], UNKNOWN)
        self.assertEqual(result["network"], "disabled")
        exported = json.dumps(result)
        for private in ("SYNTHETIC_PRIVATE_PAYLOAD", "SYNTHETIC_TOKEN",
                        "SYNTHETIC_ROUTE_SECRET", "chatgpt.com/c/"):
            self.assertNotIn(private, exported)


if __name__ == "__main__":
    unittest.main()
