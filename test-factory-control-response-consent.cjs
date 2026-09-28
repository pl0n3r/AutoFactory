'use strict';

const assert = require('node:assert/strict');
const { createResponseConsent } = require('./factory-control-response-consent.js');

const NOW = 1_800_000_000_000;

function contract(grant, overrides = {}) {
  return createResponseConsent({
    now: () => NOW,
    loadVerifiedConsent: async () => grant,
    ...overrides
  });
}

(async () => {
  const valid = {
    profileAlias: 'perfil-1',
    purpose: 'response_return',
    enabled: true,
    revoked: false,
    expiresAt: NOW + 30 * 60 * 1000
  };

  assert.deepEqual(
    await contract(valid).authorize({ profileAlias: 'perfil-1' }),
    { allowed: true, code: 'allowed' }
  );

  for (const grant of [
    null,
    { ...valid, enabled: false },
    { ...valid, revoked: true },
    { ...valid, expiresAt: NOW },
    { ...valid, expiresAt: NOW + 2 * 60 * 60 * 1000 },
    { ...valid, purpose: 'heartbeat' },
    { ...valid, profileAlias: 'perfil-2' }
  ]) {
    assert.deepEqual(
      await contract(grant).authorize({ profileAlias: 'perfil-1' }),
      { allowed: false, code: 'denied' }
    );
  }

  assert.deepEqual(
    await contract(valid).authorize({ profileAlias: 'mail@example.com' }),
    { allowed: false, code: 'invalid' }
  );

  const secret = 'secret-response-consent-token';
  const failed = createResponseConsent({
    now: () => NOW,
    loadVerifiedConsent: async () => { throw new Error(secret); }
  });
  const result = await failed.authorize({ profileAlias: 'perfil-1' });
  assert.deepEqual(result, { allowed: false, code: 'failed' });
  assert.equal(JSON.stringify(result).includes(secret), false);

  const getterSecret = 'profile-getter-secret';
  const getterInput = {};
  Object.defineProperty(getterInput, 'profileAlias', {
    enumerable: true,
    get() { throw new Error(getterSecret); }
  });
  const getterResult = await contract(valid).authorize(getterInput);
  assert.deepEqual(getterResult, { allowed: false, code: 'failed' });
  assert.equal(JSON.stringify(getterResult).includes(getterSecret), false);

  let aliasReads = 0;
  let loadedAlias = null;
  const changingGetterInput = {};
  Object.defineProperty(changingGetterInput, 'profileAlias', {
    enumerable: true,
    get() {
      aliasReads += 1;
      return aliasReads === 1 ? 'perfil-1' : 'mail@example.com';
    }
  });
  const changingGetter = createResponseConsent({
    now: () => NOW,
    loadVerifiedConsent: async ({ profileAlias }) => {
      loadedAlias = profileAlias;
      return valid;
    }
  });
  assert.deepEqual(
    await changingGetter.authorize(changingGetterInput),
    { allowed: true, code: 'allowed' }
  );
  assert.equal(aliasReads, 1);
  assert.equal(loadedAlias, 'perfil-1');

  let clockCalls = 0;
  const delayedExpiry = createResponseConsent({
    now: () => {
      clockCalls += 1;
      return NOW + 31 * 60 * 1000;
    },
    loadVerifiedConsent: async () => valid
  });
  assert.deepEqual(
    await delayedExpiry.authorize({ profileAlias: 'perfil-1' }),
    { allowed: false, code: 'denied' }
  );
  assert.equal(clockCalls, 1);

  const clockFailed = createResponseConsent({
    now: () => { throw new Error('clock-secret'); },
    loadVerifiedConsent: async () => valid
  });
  assert.deepEqual(
    await clockFailed.authorize({ profileAlias: 'perfil-1' }),
    { allowed: false, code: 'failed' }
  );

  console.log('factory-control response consent: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
