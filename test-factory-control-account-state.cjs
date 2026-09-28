'use strict';

const assert = require('node:assert/strict');
const {
  classifyAccountState,
  classifyProviderPageSignal
} = require('./factory-control-account-state.js');

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
  classifyAccountState({ authenticated: true, usageLimited: true, providerError: false, resetAt: null }, () => NOW),
  { state: 'limit', resetAt: null }
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
  { authenticated: true, usageLimited: false, providerError: true, resetAt: NOW + 1000 },
  { authenticated: true, usageLimited: false, providerError: true, resetAt: 'invalid' },
  { authenticated: true, usageLimited: true, providerError: false, resetAt: NOW - 1 },
  { authenticated: true, usageLimited: true, providerError: false, resetAt: NOW + 7 * 24 * 60 * 60 * 1000 + 1 },
  { authenticated: true, usageLimited: true, providerError: false, resetAt: NOW + 8 * 24 * 60 * 60 * 1000 }
]) {
  assert.deepEqual(classifyAccountState(input, () => NOW), { state: 'unknown', resetAt: null });
}

assert.deepEqual(
  classifyAccountState({ authenticated: true, usageLimited: false, providerError: false, resetAt: null }, () => { throw new Error('clock secret'); }),
  { state: 'unknown', resetAt: null }
);

assert.deepEqual(
  classifyAccountState({
    authenticated: true,
    usageLimited: false,
    providerError: false,
    resetAt: null,
    message: 'login email secret'
  }, () => NOW),
  { state: 'unknown', resetAt: null }
);

const localNow = new Date(2030, 0, 1, 15, 0, 0, 0).getTime();
const at1630 = new Date(2030, 0, 1, 16, 30, 0, 0).getTime();
const at1645 = new Date(2030, 0, 1, 16, 45, 0, 0).getTime();
const nextDay0215 = new Date(2030, 0, 2, 2, 15, 0, 0).getTime();

assert.deepEqual(
  classifyProviderPageSignal(
    { signalCode: 'ready', alertText: null },
    () => localNow
  ),
  { state: 'ready', resetAt: null }
);

assert.deepEqual(
  classifyProviderPageSignal(
    { signalCode: 'authentication', alertText: null },
    () => localNow
  ),
  { state: 'requires_login', resetAt: null }
);

assert.deepEqual(
  classifyProviderPageSignal(
    { signalCode: 'connection', alertText: null },
    () => localNow
  ),
  { state: 'error', resetAt: null }
);

assert.deepEqual(
  classifyProviderPageSignal(
    { signalCode: 'rate-limit', alertText: null },
    () => localNow
  ),
  { state: 'limit', resetAt: null }
);

assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'rate-limit',
      alertText: 'You have reached your usage limit. Try again at 4:30 PM.'
    },
    () => localNow
  ),
  { state: 'limit', resetAt: at1630 }
);

assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'rate-limit',
      alertText: 'Has alcanzado el límite de uso. Inténtalo de nuevo a las 16:45.'
    },
    () => localNow
  ),
  { state: 'limit', resetAt: at1645 }
);

assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'rate-limit',
      alertText: 'Usage limit reached. Resets at 2:15 a. m.'
    },
    () => localNow
  ),
  { state: 'limit', resetAt: nextDay0215 }
);

assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'rate-limit',
      alertText: 'Límite temporal sin hora de liberación.'
    },
    () => localNow
  ),
  { state: 'limit', resetAt: null }
);

const previousTz = process.env.TZ;
process.env.TZ = 'America/New_York';
const repeatedHourNow = Date.parse('2024-11-03T06:15:00Z');
const repeatedHourReset = Date.parse('2024-11-03T06:30:00Z');
assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'rate-limit',
      alertText: 'Usage limit reached. Try again at 1:30 AM.'
    },
    () => repeatedHourNow
  ),
  { state: 'limit', resetAt: repeatedHourReset }
);
if (previousTz === undefined) delete process.env.TZ;
else process.env.TZ = previousTz;

assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'rate-limit',
      alertText: 'Límite temporal. Reintenta a las 25:99.'
    },
    () => localNow
  ),
  { state: 'limit', resetAt: null }
);

assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'conversation-limit',
      alertText: null
    },
    () => localNow
  ),
  { state: 'unknown', resetAt: null }
);

assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'ready',
      alertText: 'unexpected provider text'
    },
    () => localNow
  ),
  { state: 'unknown', resetAt: null }
);

assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'rate-limit',
      alertText: 'x'.repeat(501)
    },
    () => localNow
  ),
  { state: 'unknown', resetAt: null }
);

assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'rate-limit',
      alertText: 'Límite hasta las 16:30. secret@example.com token=never-reflect'
    },
    () => localNow
  ),
  { state: 'limit', resetAt: at1630 }
);

assert.deepEqual(
  classifyProviderPageSignal(
    {
      signalCode: 'rate-limit',
      alertText: 'Reset at 4:30 PM or 5:30 PM.'
    },
    () => localNow
  ),
  { state: 'limit', resetAt: null }
);

assert.deepEqual(
  classifyProviderPageSignal(
    { signalCode: 'rate-limit', alertText: 'Reset at 4:30 PM.' },
    () => { throw new Error('clock secret'); }
  ),
  { state: 'unknown', resetAt: null }
);

const serialized = JSON.stringify([
  classifyAccountState(
    { authenticated: true, usageLimited: true, providerError: false, resetAt: NOW + 60_000 },
    () => NOW
  ),
  classifyProviderPageSignal(
    {
      signalCode: 'rate-limit',
      alertText: 'Límite hasta las 16:30. secret@example.com token=never-reflect'
    },
    () => localNow
  )
]);
for (const forbidden of ['email', 'token', 'cookie', 'chat', 'secret', 'message', 'never-reflect']) {
  assert.equal(serialized.toLowerCase().includes(forbidden), false);
}

console.log('factory-control account state contract: ok');
