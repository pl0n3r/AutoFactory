'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  createManualClock, createHeartbeatFakeclockSimulation,
  MIN_INTERVAL_MS, OFFLINE_AFTER_MISSES, MAX_BACKOFF_MS
} = require('./factory-control-heartbeat-fakeclock.js');

const PROFILE = 'sample-profile';
const START = 100_000;
const healthyConsent = () => ({
  profileAlias: PROFILE,
  purpose: 'heartbeat',
  enabled: true,
  revoked: false,
  expiresAt: 1_000_000
});
const safeSnapshot = () => ({
  profileAlias: PROFILE,
  accountAlias: 'synthetic-local',
  tabs: [{ tabId: 7, enabled: true, state: 'waiting' }],
  lastEvent: 'cycle-complete',
  accountState: { state: 'ready', resetAt: null }
});

function ports(changes = {}) {
  return {
    startAt: START,
    profileAlias: PROFILE,
    loadVerifiedConsent: async () => healthyConsent(),
    snapshot: async () => safeSnapshot(),
    deliver: async (_payload, ticket) => ({ confirmed: true, attemptId: ticket.attemptId }),
    ...changes
  };
}

async function cadence() {
  assert.equal(MIN_INTERVAL_MS, 60_000);
  assert.equal(OFFLINE_AFTER_MISSES, 3);
  const events = [];
  const sim = createHeartbeatFakeclockSimulation(ports({
    deliver: async (payload, ticket) => {
      events.push([payload.kind, ticket.attemptId]);
      return { confirmed: true, attemptId: ticket.attemptId };
    }
  }));
  assert.equal(sim.presence().state, 'unknown');
  assert.equal((await sim.tick()).outcome, 'sent');
  assert.equal(sim.presence().state, 'online');
  assert.equal(sim.presence().lastConfirmedAt, START);
  for (let i = 0; i < 24; i++) {
    assert.equal((await sim.tick()).outcome, 'waiting');
  }
  assert.equal(events.length, 1);
  assert.equal(sim.advance(59_999).state, 'online');
  assert.equal((await sim.tick()).outcome, 'waiting');
  assert.equal(sim.advance(1).state, 'stale');
  assert.equal((await sim.tick()).outcome, 'sent');
  assert.deepEqual(events, [['heartbeat', 1], ['heartbeat', 2]]);
  assert.equal(sim.advance(120_000).state, 'stale');
  assert.equal(sim.advance(60_000).state, 'offline');
  assert.equal(sim.presence().missedIntervals, 3);
  assert.equal((await sim.tick()).outcome, 'sent');
  assert.equal(sim.presence().state, 'online');
  assert.equal(sim.presence().missedIntervals, 0);
  assert.equal(events.length, 3);
  assert.equal(sim.presence().nextEligibleAt, sim.now() + MIN_INTERVAL_MS);
  assert.equal((await sim.tick()).outcome, 'waiting');
  assert.equal(events.length, 3);
}

async function revocation() {
  let consent = healthyConsent();
  let allowCurrent = true;
  let lastReceipt = null;
  let deliveries = 0;
  const sim = createHeartbeatFakeclockSimulation(ports({
    loadVerifiedConsent: async () => ({ ...consent }),
    deliver: async (_payload, ticket) => {
      deliveries += 1;
      if (!allowCurrent && lastReceipt) return lastReceipt;
      lastReceipt = { confirmed: true, attemptId: ticket.attemptId };
      return lastReceipt;
    }
  }));

  assert.equal((await sim.tick()).outcome, 'sent');
  assert.equal(deliveries, 1);
  sim.advance(60_000);
  consent.revoked = true;
  assert.equal((await sim.tick()).outcome, 'denied');
  assert.equal(deliveries, 1);
  assert.equal(sim.presence().state, 'unknown');
  assert.equal(sim.presence().lastConfirmedAt, null);

  // Revocation cannot be undone by reusing an old successful receipt.
  consent = healthyConsent();
  allowCurrent = false;
  sim.advance(120_000);
  assert.equal((await sim.tick()).outcome, 'failed');
  assert.equal(deliveries, 2);
  assert.equal(sim.presence().state, 'unknown');
  assert.equal((await sim.tick()).outcome, 'waiting');

  allowCurrent = true;
  sim.advance(240_000);
  assert.equal((await sim.tick()).outcome, 'sent');
  assert.equal(deliveries, 3);
  assert.equal(sim.presence().state, 'online');
  assert.equal(sim.presence().consecutiveFailures, 0);

  // Expired consent never delivers or renews presence; no automatic approval.
  sim.advance(60_000);
  consent.expiresAt = sim.now();
  assert.equal((await sim.tick()).outcome, 'denied');
  assert.equal(deliveries, 3);
  assert.equal(sim.presence().state, 'unknown');

  sim.stop();
  assert.equal((await sim.tick()).outcome, 'stopped');
  assert.equal(deliveries, 3);
}

async function unknown() {
  for (const value of [null, {}, [], { ...ports(), socket: 'unknown' },
    { ...ports(), deliver: null }, { ...ports(), startAt: Number.NaN },
    { ...ports(), startAt: -1 }]) {
    assert.throws(() => createHeartbeatFakeclockSimulation(value), TypeError);
  }
  const clock = createManualClock(123);
  assert.equal(clock.now(), 123);
  for (const delta of [null, undefined, NaN, Infinity, -1, 0.5, '60000']) {
    assert.throws(() => clock.advance(delta), RangeError);
  }
  assert.equal(clock.now(), 123);
  assert.throws(() => createManualClock(Number.MAX_SAFE_INTEGER), TypeError);

  let sends = 0;
  const sim = createHeartbeatFakeclockSimulation(ports({
    snapshot: async () => ({ ...safeSnapshot(), chatText: 'private' }),
    deliver: async (_payload, ticket) => {
      sends += 1;
      return { confirmed: true, attemptId: ticket.attemptId };
    }
  }));
  assert.equal((await sim.tick()).outcome, 'failed');
  assert.equal(sim.presence().state, 'unknown');
  assert.equal(sends, 0);
  assert.equal(sim.advance(60_000).state, 'unknown');
  assert.equal((await sim.tick()).outcome, 'failed');
  assert.equal(sends, 0);
  sim.advance(120_000);
  assert.equal((await sim.tick()).outcome, 'failed');
  assert.equal(sim.presence().state, 'offline');
  assert.equal(sends, 0);
}

async function backoff() {
  let calls = 0;
  const sim = createHeartbeatFakeclockSimulation(ports({
    deliver: async (_payload, ticket) => {
      calls += 1;
      return { confirmed: false, attemptId: ticket.attemptId };
    }
  }));
  assert.equal(MAX_BACKOFF_MS, 240_000);
  const expected = [60_000, 120_000, 240_000, 240_000];
  for (let i = 0; i < expected.length; i++) {
    assert.equal((await sim.tick()).outcome, 'failed');
    assert.equal(sim.presence().nextEligibleAt, sim.now() + expected[i]);
    for (let j = 0; j < 40; j++) {
      assert.equal((await sim.tick()).outcome, 'waiting');
    }
    assert.equal(calls, i + 1);
    sim.advance(expected[i] - 1);
    assert.equal((await sim.tick()).outcome, 'waiting');
    sim.advance(1);
  }
  assert.equal(calls, 4);
  assert.equal(sim.presence().state, 'offline');
  assert.equal(sim.presence().fakeDeliveries, 4);
  sim.stop();
  assert.equal((await sim.tick()).outcome, 'stopped');
  assert.equal(calls, 4);

  // The simulator imports only the already-merged coordinator and node-free code;
  // it cannot establish real transport, timers, access the extension or change permissions.
  const code = fs.readFileSync(require.resolve('./factory-control-heartbeat-fakeclock.js'), 'utf8');
  for (const forbidden of [
    'setInterval(', 'setTimeout(', 'WebSocket(', 'fetch(', 'XMLHttpRequest',
    'chrome.', 'browser.', 'http.request(', 'https.request(', 'localStorage'
  ]) {
    assert.equal(code.includes(forbidden), false, forbidden);
  }
}

const scenarios = Object.freeze({ cadence, revocation, unknown, backoff });
(async () => {
  const requested = process.argv[2];
  if (requested && !Object.hasOwn(scenarios, requested)) {
    throw new TypeError('Unrecognized synthetic acceptance scenario');
  }
  for (const key of requested ? [requested] : Object.keys(scenarios)) {
    await scenarios[key]();
    console.log('heartbeat-fakeclock ' + key + ': ok');
  }
})().catch(error => {
  console.error('heartbeat-fakeclock acceptance failed:', error.message);
  process.exitCode = 1;
});
