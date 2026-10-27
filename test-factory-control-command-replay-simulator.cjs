'use strict';
const assert = require('node:assert/strict');
const { createMemoryReceiptStorage, createReplaySimulator } =
  require('./factory-control-command-replay-simulator.js');

function fixture(id, overrides = {}) {
  return { id, identity: 'active', issuedAt: 900, expiresAt: 1100,
    outcome: 'ok', ack: 'delivered', ...overrides };
}

async function main() {
  // ACK lost after a committed effect; the same command is not sent twice.
  const storage = createMemoryReceiptStorage(), effects = { count: 0 };
  const first = createReplaySimulator({ storage, effects });
  assert.deepEqual(await first.submit(fixture('fixture_lost', { ack: 'lost' })),
    { ok: false, code: 'timeout' });
  assert.deepEqual(storage.snapshot(), [
    { id: 'fixture_lost', state: 'done', code: 'ok' }
  ]);
  const restarted = createReplaySimulator({ storage, effects });
  assert.deepEqual(await restarted.submit(fixture('fixture_lost')),
    { ok: false, code: 'already_handled' });
  assert.equal(restarted.effectCount(), 1);
  assert.deepEqual(await restarted.submit(fixture('fixture_lost', { outcome: 'failed' })),
    { ok: false, code: 'already_handled' });
  assert.equal(restarted.effectCount(), 1);

  // Late result remains a pending receipt even across ledger recreation.
  const lateStore = createMemoryReceiptStorage(), lateEffects = { count: 0 };
  const late = createReplaySimulator({ storage: lateStore, effects: lateEffects });
  assert.deepEqual(await late.submit(fixture('fixture_late', { outcome: 'late' })),
    { ok: false, code: 'not_ready' });
  assert.equal(lateStore.snapshot()[0].state, 'pending');
  assert.deepEqual(await createReplaySimulator({ storage: lateStore, effects: lateEffects })
    .submit(fixture('fixture_late')), { ok: false, code: 'not_ready' });
  assert.equal(lateEffects.count, 1);

  // Incomplete final durable write after a simulated effect: fail closed.
  const crashStore = createMemoryReceiptStorage();
  crashStore.failNextFinalWrite();
  const crashEffects = { count: 0 };
  assert.deepEqual(await createReplaySimulator({ storage: crashStore, effects: crashEffects })
    .submit(fixture('fixture_crash')), { ok: false, code: 'not_ready' });
  assert.equal(crashStore.snapshot()[0].state, 'pending');
  assert.deepEqual(await createReplaySimulator({ storage: crashStore, effects: crashEffects })
    .submit(fixture('fixture_crash')), { ok: false, code: 'not_ready' });
  assert.equal(crashEffects.count, 1);
  console.log('AC-01: lost ACK, replay, late outcome, persistent restart: PASS');

  const negativeStore = createMemoryReceiptStorage();
  const negatives = createReplaySimulator({ storage: negativeStore });
  assert.deepEqual(await negatives.submit(fixture('fixture_revoked', { identity: 'revoked' })),
    { ok: false, code: 'unauthorized' });
  assert.deepEqual(await negatives.submit(fixture('fixture_stale', { expiresAt: 1000 })),
    { ok: false, code: 'timeout' });
  assert.deepEqual(await negatives.submit(fixture('fixture_future', { issuedAt: 1010 })),
    { ok: false, code: 'timeout' });
  assert.deepEqual(await negatives.submit(fixture('fixture_bad', { identity: 'unknown' })),
    { ok: false, code: 'invalid' });
  assert.deepEqual(await negatives.submit(fixture('fixture_bad', { payload: 'not permitted' })),
    { ok: false, code: 'invalid' });
  assert.deepEqual(await negatives.submit(null), { ok: false, code: 'invalid' });
  assert.equal(negatives.effectCount(), 0);
  assert.deepEqual(negativeStore.snapshot(), []);
  const opaqueFailure = await negatives.submit(fixture('fixture_failed', { outcome: 'failed' }));
  assert.deepEqual(opaqueFailure, { ok: false, code: 'failed' });
  assert.deepEqual(Object.keys(opaqueFailure), ['ok', 'code']);
  assert.equal(negatives.effectCount(), 1);
  assert.deepEqual(await negatives.submit(fixture('fixture_failed')),
    { ok: false, code: 'already_handled' });
  assert.equal(negatives.effectCount(), 1);
  assert.doesNotMatch(JSON.stringify(negativeStore.snapshot()),
    /payload|conversation|token|email|private/);
  console.log('AC-02: revoked, stale, unknown, opaque failures and no real effects: PASS');
}
main().catch((_error) => {
  // Privacy by construction: no adapter error or synthetic command content.
  console.error('Offline command replay assertions failed');
  process.exitCode = 1;
});
