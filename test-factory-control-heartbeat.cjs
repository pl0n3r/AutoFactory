const assert = require('node:assert/strict');
const { createHeartbeatCoordinator, MIN_INTERVAL_MS } = require('./factory-control-heartbeat.js');

const synthetic = () => ({
  profileAlias: 'sample-profile', accountAlias: 'synthetic-local',
  tabs: [{ tabId: 7, enabled: true, state: 'waiting' }], lastEvent: 'cycle-complete'
});
const validConsent = () => ({
  profileAlias: 'sample-profile', enabled: true, revoked: false,
  expiresAt: 1000000
});

(async () => {
  assert.equal(MIN_INTERVAL_MS, 60000);
  assert.throws(() => createHeartbeatCoordinator({}), /requires/);

  let time = 100000;
  let consent = validConsent();
  let snapshots = 0;
  let deliveries = [];
  const build = (overrides = {}) => createHeartbeatCoordinator({
    loadVerifiedConsent: async () => structuredClone(consent),
    snapshot: async () => { snapshots += 1; return synthetic(); },
    deliver: async value => { deliveries.push(value); },
    now: () => time,
    profileAlias: 'sample-profile',
    ...overrides
  });

  let heartbeat = build();
  consent = null;
  assert.equal(await heartbeat.tick(), 'denied');
  assert.equal(snapshots, 0);
  assert.equal(deliveries.length, 0);
  assert.equal(await heartbeat.tick(), 'throttled');
  time += MIN_INTERVAL_MS;
  consent = validConsent();
  assert.equal(await heartbeat.tick(), 'sent');
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0], {
    version: 1, kind: 'heartbeat',
    ...synthetic()
  });
  assert.equal(JSON.stringify(deliveries).includes('private chat'), false);
  time += MIN_INTERVAL_MS - 1;
  assert.equal(await heartbeat.tick(), 'throttled');
  time += 1;
  assert.equal(await heartbeat.tick(), 'sent');
  heartbeat.stop();
  assert.equal(await heartbeat.tick(), 'stopped');

  for (const changed of [
    { enabled: false }, { revoked: true }, { expiresAt: time - 1 },
    { expiresAt: time + 86400001 }, { profileAlias: 'other-profile' },
    { accountAlias: 'private@example.test' }
  ]) {
    consent = { ...validConsent(), ...changed };
    heartbeat = build();
    const before = snapshots;
    const sent = deliveries.length;
    assert.equal(await heartbeat.tick(), 'denied');
    assert.equal(snapshots, before);
    assert.equal(deliveries.length, sent);
  }
  consent = validConsent();
  time = 100000;
  heartbeat = build({ snapshot: async () => ({ ...synthetic(), chatText: 'private chat' }) });
  assert.equal(await heartbeat.tick(), 'failed');
  assert.equal(deliveries.length, 2);

  heartbeat = build({ snapshot: async () => ({ ...synthetic(), profileAlias: 'another-profile' }) });
  assert.equal(await heartbeat.tick(), 'denied');
  heartbeat = build({ snapshot: async () => ({ ...synthetic(), tabs: Array(1) }) });
  assert.equal(await heartbeat.tick(), 'failed');

  heartbeat = build({ snapshot: async () => {
    consent.revoked = true;
    return synthetic();
  } });
  assert.equal(await heartbeat.tick(), 'denied');
  assert.equal(deliveries.length, 2);

  consent = validConsent();
  heartbeat = build({
    loadVerifiedConsent: async () => { throw Error('private API token and alias'); }
  });
  assert.equal(await heartbeat.tick(), 'failed');
  assert.equal(await heartbeat.tick(), 'throttled');

  heartbeat = build({
    deliver: async () => { throw Error('secret delivery response'); }
  });
  assert.equal(await heartbeat.tick(), 'failed');
  assert.equal(await heartbeat.tick(), 'throttled');

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  heartbeat = build({
    snapshot: async () => {
      await gate;
      return synthetic();
    }
  });
  const first = heartbeat.tick();
  assert.equal(await heartbeat.tick(), 'busy');
  heartbeat.stop();
  release();
  assert.equal(await first, 'denied');
  assert.equal(deliveries.length, 2);

  heartbeat = build({ now: () => Infinity });
  assert.equal(await heartbeat.tick(), 'failed');
  console.log('Factory Control heartbeat: consent, 60s cadence, revocation and safe failures pass');
})().catch(error => { console.error(error); process.exitCode = 1; });
