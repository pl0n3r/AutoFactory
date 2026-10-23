"""#228: synthetic, offline Chrome/Safari state parity and denial contracts.

The Node fixtures load the actual mirrored extension sources, but never start a
browser, request permissions, authenticate or contact a provider.
"""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]

NODE_HARNESS = r"""
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const chrome = require('./factory-control-protocol.js');
const safari = require('./safari/ChatGPT Autopilot Local Extension/Resources/factory-control-protocol.js');
const chromeAuth = require('./factory-control-authorization.js');
const safariAuth = require('./safari/ChatGPT Autopilot Local Extension/Resources/factory-control-authorization.js');
const chromeRuntime = require('./factory-control-runtime.js');
const safariRuntime = require('./safari/ChatGPT Autopilot Local Extension/Resources/factory-control-runtime.js');
const { buildReadinessReport } = require('./factory-control-readiness-report.js');

const NOW = 1800000000000;
const SAFARI = 'safari/ChatGPT Autopilot Local Extension/Resources';
const STATES = ['ready', 'limit', 'requires_login', 'error', 'unknown'];
const account = state => ({ state, resetAt: state === 'limit' ? NOW + 60000 : null });
const sample = state => ({
  profileAlias: 'synthetic-profile', accountAlias: 'synthetic-account',
  tabs: [{ tabId: 7, enabled: true, state: 'waiting' }],
  accountState: account(state), lastEvent: 'cycle-complete'
});
const signals = (state, observedAt = NOW - 1000) => ({
  pairing: { state: 'paired', observedAt: NOW - 1000 },
  heartbeat: { state: 'online', observedAt: NOW - 1000 },
  orders: { state: 'ready', observedAt: NOW - 1000 },
  account: { state, observedAt }
});
function report(state, observedAt) {
  return buildReadinessReport(signals(state, observedAt), { nowMs: NOW });
}
function assertMirrors() {
  for (const name of ['factory-control-protocol.js',
      'factory-control-authorization.js', 'factory-control-runtime.js']) {
    assert.equal(
      fs.readFileSync(path.join(process.cwd(), name), 'utf8'),
      fs.readFileSync(path.join(process.cwd(), SAFARI, name), 'utf8'),
      name + ' Chrome/Safari source drift'
    );
  }
}
function parity() {
  assertMirrors();
  assert.equal(report('ready').ready, true);
  for (const state of STATES) {
    const input = sample(state);
    const left = chrome.heartbeat(input);
    const right = safari.heartbeat(input);
    assert.deepEqual(left, right, state);
    assert.deepEqual(left.accountState, account(state));
    assert.deepEqual(Object.keys(left.accountState), ['state', 'resetAt']);
    const diagnostic = report(state);
    assert.equal(diagnostic.mode, 'offline_diagnostic_only');
    assert.equal(diagnostic.ready, state === 'ready', state);
    assert.equal(diagnostic.signals.account.state,
      state === 'ready' ? 'ready' : state === 'unknown' ? 'UNKNOWN' : 'blocked');
  }
  for (const bad of [
    { state: 'made_up', resetAt: null },
    { state: 'requires_login', resetAt: 1 },
    { state: 'ready', resetAt: NOW },
    { state: 'limit', resetAt: 'not-a-clock' },
    { state: 'unknown', resetAt: null, privateText: 'never-export' }
  ]) {
    assert.throws(() => chrome.heartbeat({ ...sample('ready'), accountState: bad }));
    assert.throws(() => safari.heartbeat({ ...sample('ready'), accountState: bad }));
  }
}
async function denials() {
  assertMirrors();
  let attemptedCommands = 0;
  const command = {
    id: 'synthetic-1', action: 'send_message',
    target: 7, payload: { text: 'SYNTHETIC_NEVER_DISPATCHED' }
  };
  const context = { profileAlias: 'synthetic-profile', enabledTabIds: [7] };
  for (const state of ['limit', 'requires_login', 'error', 'unknown']) {
    const diagnostic = report(state);
    assert.equal(diagnostic.ready, false, state);
    assert.notEqual(diagnostic.signals.account.state, 'ready');
  }
  for (const observedAt of [NOW - 180001, NOW + 1]) {
    const diagnostic = report('ready', observedAt);
    assert.equal(diagnostic.ready, false);
    assert.equal(diagnostic.signals.account.state, 'UNKNOWN');
  }
  const stale = report('ready', NOW - 180001);
  assert.equal(stale.signals.account.freshness, 'stale');
  assert.equal(stale.signals.account.reason, 'stale_evidence');
  for (const authorization of [chromeAuth, safariAuth]) {
    const authorizer = authorization.createCommandAuthorizer({
      loadVerifiedGrant: async () => null, now: () => NOW
    });
    await assert.rejects(authorizer.authorize(command, context), {
      name: 'TypeError', message: 'Command not authorized'
    });
  }
  for (const source of [chromeRuntime, safariRuntime]) {
    const runtime = source.createFactoryControlRuntime({
      createHeartbeat: () => { throw new Error('must not activate'); },
      loadContext: async () => { throw new Error('must not load user'); },
      pump: { runOnce: async () => { attemptedCommands += 1; } }
    });
    assert.deepEqual(await runtime.runCommands(), { ok: false, code: 'stopped' });
  }
  assert.equal(attemptedCommands, 0);
  await activeSessionDenials(command, context);
}
// Exercise the same offline readiness boundary with an ACTIVE synthetic runtime
// and a valid, short-lived grant. This is fixture wiring, never a live adapter.
async function activeSessionDenials(command, context) {
  const grant = {
    profileAlias: 'synthetic-profile', expiresAt: NOW + 60000,
    revoked: false, actions: ['send_message'], tabIds: [7], broadcast: false
  };
  const deniedCases = [
    ...['limit', 'requires_login', 'error', 'unknown'].map(state => [state, NOW - 1000]),
    ['ready', NOW - 180001], // STALE
    ['ready', NOW + 1] // Future evidence is not current
  ];
  for (const [runtimeModule, authorization] of [
    [chromeRuntime, chromeAuth], [safariRuntime, safariAuth]
  ]) {
    const authorizer = authorization.createCommandAuthorizer({
      loadVerifiedGrant: async () => grant, now: () => NOW
    });
    // Positive control: the grant and command are valid. Denials below must
    // come from the unsafe account evidence, not from a missing grant.
    assert.equal((await authorizer.authorize(command, context)).action,
      'send_message');
    for (const [state, observedAt] of deniedCases) {
      const readiness = report(state, observedAt);
      assert.equal(readiness.ready, false, state + ':' + observedAt);
      let proposed = 0;
      const runtime = runtimeModule.createFactoryControlRuntime({
        createHeartbeat: () => ({ tick: async () => 'sent', stop() {} }),
        loadContext: async ({ profileAlias }) => ({
          profileAlias, enabledTabIds: [7]
        }),
        pump: {
          runOnce: async ({ context: activeContext }) => {
            // Offline simulated integration contract: never call the
            // authorizer or propose a command if readiness is not proven.
            if (!readiness.ready) {
              return { ok: true, code: 'empty', cursor: null };
            }
            const approved = await authorizer.authorize(command, activeContext);
            proposed += 1;
            return {
              ok: true, code: 'handled', cursor: null,
              commandId: approved.id, outcome: 'ok'
            };
          }
        }
      });
      assert.deepEqual(
        runtime.start({ profileAlias: context.profileAlias, cursor: null }),
        { ok: true, code: 'started' }
      );
      assert.deepEqual(await runtime.runCommands(),
        { ok: true, code: 'empty', cursor: null }, state);
      assert.equal(proposed, 0, state + ' proposed an action');
      assert.deepEqual(runtime.stop(), { ok: true, code: 'stopped' });
    }
  }
}
const mode = process.argv[1];
if (mode === 'parity') parity();
else if (mode === 'denials') denials().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
else throw new Error('Unexpected offline acceptance criterion');
"""


class OfflineBrowserStateParityTests(unittest.TestCase):
    def run_contract(self, mode: str) -> None:
        completed = subprocess.run(
            ["node", "-e", NODE_HARNESS, mode], cwd=ROOT,
            text=True, capture_output=True, timeout=30, check=False
        )
        self.assertEqual(
            completed.returncode, 0,
            f"{mode}: {completed.stderr[-1600:]} {completed.stdout[-300:]}"
        )

    def test_synthetic_session_states_match_chrome_and_safari_sources(self):
        self.run_contract("parity")

    def test_denied_unknown_or_stale_states_never_trigger_remote_actions(self):
        self.run_contract("denials")


if __name__ == "__main__":
    unittest.main()
