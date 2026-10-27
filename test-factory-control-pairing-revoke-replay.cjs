'use strict';
const assert = require('node:assert/strict');
const { simulateSyntheticRevokeReplay } =
  require('./factory-control-pairing-revoke-replay.js');

async function main() {
  const revoked = await simulateSyntheticRevokeReplay('revoked');
  // Only public result codes and booleans: safe CI diagnostic, never handles.
  console.log('revoke-replay fixture state: ' + JSON.stringify({
    first: revoked.first, revocation: revoked.revocation,
    before: revoked.before, after: revoked.after, replay: revoked.replay
  }));
  assert.deepEqual(revoked.first, { ok: true, code: 'paired' });
  assert.deepEqual(revoked.revocation, { ok: true, code: 'revoked' });
  assert.equal(revoked.before.credentialStored, true);
  assert.equal(revoked.before.revoked, false);
  assert.equal(revoked.after.credentialStored, false);
  assert.equal(revoked.after.revoked, true);
  assert.deepEqual(revoked.replay, { ok: false, code: 'revoked' });
  assert.equal(revoked.after.challengeConsumed, true);
  console.log('pairing-revoke-replay AC-01: ok');

  const consumed = await simulateSyntheticRevokeReplay('consumed');
  assert.deepEqual(consumed.first, { ok: true, code: 'paired' });
  assert.deepEqual(consumed.replay, { ok: false, code: 'replayed' });
  assert.equal(consumed.after.challengeConsumed, true);
  const expired = await simulateSyntheticRevokeReplay('expired');
  assert.deepEqual(expired.replay, { ok: false, code: 'expired' });
  assert.equal(expired.after.credentialStored, false);
  const unknown = await simulateSyntheticRevokeReplay('unknown');
  assert.deepEqual(unknown.replay, { ok: false, code: 'failed' });
  assert.equal(unknown.after.uncertain, true);
  assert.equal(unknown.after.credentialStored, false);
  assert.deepEqual(await simulateSyntheticRevokeReplay('live'),
    { ok: false, code: 'invalid' });
  assert.deepEqual(await simulateSyntheticRevokeReplay({ mode: 'revoked' }),
    { ok: false, code: 'invalid' });

  for (const report of [revoked, consumed, expired, unknown]) {
    assert.equal(Object.isFrozen(report), true);
    const serialized = JSON.stringify(report);
    for (const forbidden of ['fixture-opaque-handle-01', '123456',
      'fixture-profile-01', 'fixture-challenge-01']) {
      assert.equal(serialized.includes(forbidden), false);
    }
  }
  console.log('pairing-revoke-replay AC-02: ok');
}

main().catch(() => {
  // Fixed error message: never print an adapter exception or test handle.
  console.error('Synthetic pairing replay contract failed');
  process.exitCode = 1;
});
