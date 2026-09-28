'use strict';

const assert = require('node:assert/strict');
const { classifyAccountState } = require('./factory-control-account-state.js');

const NOW = 1_800_000_000_000;

assert.deepEqual(
  classifyAccountState({ authenticated: true, usageLimited: false, providerError: false, resetAt: null }, () => NOW),
  { state: 'ready', resetAt: null }
);

assert.deepEqual(
  classifyAccountState({ authenticated: true, usageLimited: true, providerError: false, resetAt: NOW + 3_600_000 }, () => NOW),
  { state: 'limit', resetAt: NOW + 3_600_000 }
);

assert.deepEqual(
  classifyAccountState({ authenticated: false, usageLimited: false, providerError: false, resetAt: null }, () => NOW),
  { state: 'requires_login', resetAt: null }
);

assert.deepEqual(
  classifyAccountState({ authenticated: true, usageLimited: false, providerError: true, resetAt: null }, () => NOW),
  { state: 'error', resetAt: null }
);

for (const input of [
  { authenticated: false, usageLimited: true, providerError: false, resetAt: NOW + 1000 },
  { authenticated: false, usageLimited: false, providerError: true, resetAt: null },
  { authenticated: true, usageLimited: false, providerError: false, resetAt: NOW + 1000 },
  { authenticated: true, usageLimited: true, providerError: false, resetAt: NOW - 1 },
  { authenticated: true, usageLimited: true, providerError: false, resetAt: NOW + 8 * 24 * 60 * 60 * 1000 }
]) {
  assert.deepEqual(classifyAccountState(input, () => NOW), { state: 'unknown', resetAt: null });
}

assert.deepEqual(
  classifyAccountState({ authenticated: true, usageLimited: false, providerError: false, resetAt: null }, () => { throw new Error('clock secret'); }),
  { state: 'unknown', resetAt: null }
);

assert.throws(
  () => classifyAccountState({
    authenticated: true,
    usageLimited: false,
    providerError: false,
    resetAt: null,
    message: 'login email secret'
  }, () => NOW),
  /Invalid account state signal/
);

const serialized = JSON.stringify(
  classifyAccountState({ authenticated: true, usageLimited: true, providerError: false, resetAt: NOW + 60_000 }, () => NOW)
);
for (const forbidden of ['email', 'token', 'cookie', 'chat', 'secret', 'message']) {
  assert.equal(serialized.toLowerCase().includes(forbidden), false);
}

console.log('factory-control account state contract: ok');
