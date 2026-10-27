'use strict';
// Offline-only composition test: existing Node contracts, fictitious in-memory
// ports and deterministic clocks. NOT imported by any browser extension runtime.
const assert = require('node:assert/strict');
const { simulateSyntheticRevokeReplay } = require('./factory-control-pairing-revoke-replay.js');
const { createHeartbeatFakeclockSimulation } = require('./factory-control-heartbeat-fakeclock.js');
const { createMemoryReceiptStorage, createReplaySimulator } =
  require('./factory-control-command-replay-simulator.js');
const { evaluate } = require('./factory-control-account-state-freshness.js');
const { createFactoryControlKillSwitch } = require('./factory-control-kill-switch.js');

const START = 100_000;
const ALIAS = 'sample-profile';
const order = (id, change = {}) => ({
  id, identity: 'active', issuedAt: 900, expiresAt: 1100,
  outcome: 'ok', ack: 'delivered', ...change
});
const observation = (signalCode = 'ready', observedAt = 1000) => ({
  observations: [{ signalCode, observedAt, resetAt: null }],
  previousObservedAt: null, maxAgeMs: 100
});
const validConsent = () => ({
  profileAlias: ALIAS, purpose: 'heartbeat', enabled: true,
  revoked: false, expiresAt: START + 900_000
});
const heartbeatPorts = (options = {}) => ({
  startAt: START, profileAlias: ALIAS,
  loadVerifiedConsent: async () => validConsent(),
  snapshot: async () => ({
    profileAlias: ALIAS, accountAlias: 'synthetic-local',
    tabs: [{ tabId: 7, enabled: true, state: 'waiting' }],
    lastEvent: 'cycle-complete',
    accountState: { state: 'ready', resetAt: null }
  }),
  deliver: async (_snapshot, receipt) => ({
    confirmed: true, attemptId: receipt.attemptId
  }),
  ...options
});
const evidence = [];
function audit(code) {
  // Allowlisted event codes only, never command contents or provider payloads.
  assert.match(code, /^[a-z_]+$/);
  evidence.push(code);
}
function killFake(options = {}) {
  const ops = [];
  const kill = createFactoryControlKillSwitch({
    executeCommand: async () => true,
    stopBridge: () => { ops.push('stop'); return true; },
    revokePairing: () => { ops.push('revoke'); return true; },
    restoreSafeState: () => { ops.push('rollback'); return true; },
    now: () => START, ...options
  });
  return { kill, ops };
}

async function main() {
  const pair = await simulateSyntheticRevokeReplay('consumed');
  assert.deepEqual(pair.first, { ok: true, code: 'paired' });
  assert.deepEqual(pair.replay, { ok: false, code: 'replayed' });
  audit('pairing');

  const heartbeat = createHeartbeatFakeclockSimulation(heartbeatPorts());
  assert.equal(heartbeat.presence().state, 'unknown');
  assert.equal((await heartbeat.tick()).outcome, 'sent');
  assert.equal(heartbeat.presence().state, 'online');
  assert.equal((await heartbeat.tick()).outcome, 'waiting');
  audit('heartbeat');

  const fresh = evaluate(observation(), () => 1000);
  assert.deepEqual([fresh.state, fresh.canResume, fresh.freshness], ['ready', true, 'fresh']);
  audit('admission');

  const storage = createMemoryReceiptStorage();
  const effects = { count: 0 };
  const commands = createReplaySimulator({ storage, effects, now: () => 1000 });
  assert.deepEqual(await commands.submit(order('fixture_chain_01', { ack: 'lost' })),
    { ok: false, code: 'timeout' });
  assert.equal(effects.count, 1, 'ACK loss cannot retry an effect');
  audit('order');
  assert.deepEqual(await createReplaySimulator({ storage, effects, now: () => 1000 })
    .submit(order('fixture_chain_01')), { ok: false, code: 'already_handled' });
  assert.equal(effects.count, 1);
  assert.deepEqual(storage.snapshot().map(row => row.state), ['done']);
  audit('replay');

  const revoked = await simulateSyntheticRevokeReplay('revoked');
  assert.deepEqual(revoked.revocation, { ok: true, code: 'revoked' });
  assert.deepEqual(revoked.replay, { ok: false, code: 'revoked' });
  assert.equal(revoked.after.credentialStored, false);
  audit('revocation');

  const stopped = killFake();
  assert.deepEqual(await stopped.kill.dispatch({ fixture: true }),
    { ok: true, code: 'handled' });
  const result = await stopped.kill.kill();
  assert.equal(result.status, 'safe');
  assert.deepEqual(stopped.ops, ['stop', 'revoke', 'rollback']);
  assert.deepEqual(await stopped.kill.dispatch({ fixture: true }),
    { ok: false, code: 'stopped' });
  assert.equal(await stopped.kill.kill(), result, 'kill is idempotent');
  audit('rollback');
  assert.deepEqual(evidence, [
    'pairing', 'heartbeat', 'admission', 'order', 'replay', 'revocation', 'rollback'
  ]);
  console.log('bridge-e2e AC-01: full fake chain + lost ACK replay: PASS');

  // Fail closed on stale/replayed signals, rate limits, login and unknown input.
  for (const scenario of [
    observation('rate-limit'), observation('authentication'),
    observation('ready', 800),
    { ...observation(), previousObservedAt: 1000 },
    { ...observation(), observations: [{ signalCode: 'mystery', observedAt: 1000, resetAt: null }] },
    { ...observation(), observations: [
      { signalCode: 'ready', observedAt: 1000, resetAt: null },
      { signalCode: 'rate-limit', observedAt: 1000, resetAt: null }
    ] }
  ]) {
    const decision = evaluate(scenario, () => 1000);
    assert.equal(decision.canResume, false);
    assert.notEqual(decision.state, 'ready');
  }
  assert.deepEqual(await commands.submit(order('fixture_revoked', { identity: 'revoked' })),
    { ok: false, code: 'unauthorized' });
  assert.deepEqual(await commands.submit(order('fixture_stale', { expiresAt: 1000 })),
    { ok: false, code: 'timeout' });
  assert.deepEqual(await commands.submit({ ...order('fixture_unknown'), extra: 'opaque' }),
    { ok: false, code: 'invalid' });
  assert.equal(effects.count, 1, 'denied inputs cause no new fake effect');

  let deliverCount = 0;
  const deniedHeartbeat = createHeartbeatFakeclockSimulation(heartbeatPorts({
    loadVerifiedConsent: async () => ({ ...validConsent(), revoked: true }),
    deliver: async (_snapshot, ticket) => {
      deliverCount += 1;
      return { confirmed: true, attemptId: ticket.attemptId };
    }
  }));
  assert.equal((await deniedHeartbeat.tick()).outcome, 'denied');
  assert.equal(deniedHeartbeat.presence().state, 'unknown');
  assert.equal(deliverCount, 0);
  assert.throws(() => createHeartbeatFakeclockSimulation(null), TypeError);

  // A failed stop must not claim a rollback or execute restoration.
  let restored = 0;
  const failedRollback = killFake({
    stopBridge: () => false,
    restoreSafeState: () => { restored += 1; return true; }
  });
  const rollback = await failedRollback.kill.kill();
  assert.equal(rollback.status, 'rollback_failed');
  assert.equal(rollback.restored, false);
  assert.equal(restored, 0);
  assert.deepEqual(await failedRollback.kill.dispatch({}), { ok: false, code: 'stopped' });

  // The harness only exposes allowlisted categories. No fixture identities,
  // PINs, handles, chat text or adapter errors are printed or persisted.
  const output = JSON.stringify({ evidence, rollback: rollback.status });
  for (const forbidden of ['sample-profile', 'fixture_chain_01', '123456',
    'fixture-opaque-handle-01', 'conversation', 'private_key', 'token']) {
    assert.equal(output.includes(forbidden), false);
  }
  assert.equal(typeof globalThis.chrome, 'undefined');
  console.log('bridge-e2e AC-02: fail-closed, no real transport, rollback: PASS');
}
main().catch(() => {
  // Redacted and fixed output: never print raw adapter/input exceptions.
  console.error('Synthetic bridge E2E failed');
  process.exitCode = 1;
});
