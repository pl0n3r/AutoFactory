'use strict';

const assert = require('node:assert/strict');
const {
  classifyAccountState,
  classifyProviderPageSignal,
  createProviderAccountStateReader
} = require('./factory-control-account-state.js');

const NOW = 1_800_000_000_000;
const UNKNOWN = Object.freeze({ state: 'unknown', resetAt: null });

function account(input, expected, now = NOW) {
  assert.deepEqual(classifyAccountState(input, () => now), expected);
}

function signal(signalCode, alertText, expected, now) {
  assert.deepEqual(
    classifyProviderPageSignal({ signalCode, alertText }, () => now),
    expected
  );
}

account(
  { authenticated: true, usageLimited: false, providerError: false, resetAt: null },
  { state: 'ready', resetAt: null }
);
account(
  { authenticated: true, usageLimited: true, providerError: false, resetAt: NOW + 3_600_000 },
  { state: 'limit', resetAt: NOW + 3_600_000 }
);
account(
  { authenticated: true, usageLimited: true, providerError: false, resetAt: null },
  { state: 'limit', resetAt: null }
);
account(
  { authenticated: false, usageLimited: false, providerError: false, resetAt: null },
  { state: 'requires_login', resetAt: null }
);
account(
  { authenticated: true, usageLimited: false, providerError: true, resetAt: null },
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
  account(input, UNKNOWN);
}

assert.deepEqual(
  classifyAccountState(
    { authenticated: true, usageLimited: false, providerError: false, resetAt: null },
    () => { throw new Error('clock secret'); }
  ),
  UNKNOWN
);
account(
  {
    authenticated: true,
    usageLimited: false,
    providerError: false,
    resetAt: null,
    message: 'login email secret'
  },
  UNKNOWN
);

const localNow = new Date(2030, 0, 1, 15, 0, 0, 0).getTime();
const at1630 = new Date(2030, 0, 1, 16, 30, 0, 0).getTime();
const at1645 = new Date(2030, 0, 1, 16, 45, 0, 0).getTime();
const nextDay0215 = new Date(2030, 0, 2, 2, 15, 0, 0).getTime();

for (const [signalCode, alertText, expected] of [
  ['ready', null, { state: 'ready', resetAt: null }],
  ['authentication', null, { state: 'requires_login', resetAt: null }],
  ['connection', null, { state: 'error', resetAt: null }],
  ['rate-limit', null, { state: 'limit', resetAt: null }],
  ['rate-limit', 'You have reached your usage limit. Try again at 4:30 PM.', { state: 'limit', resetAt: at1630 }],
  ['rate-limit', 'Has alcanzado el límite de uso. Inténtalo de nuevo a las 16:45.', { state: 'limit', resetAt: at1645 }],
  ['rate-limit', 'Usage limit reached. Resets at 2:15 a. m.', { state: 'limit', resetAt: nextDay0215 }],
  ['rate-limit', 'Límite temporal sin hora de liberación.', { state: 'limit', resetAt: null }],
  ['rate-limit', 'Límite temporal. Reintenta a las 25:99.', { state: 'limit', resetAt: null }],
  ['conversation-limit', null, UNKNOWN],
  ['ready', 'unexpected provider text', UNKNOWN],
  ['rate-limit', 'x'.repeat(501), UNKNOWN],
  ['rate-limit', 'Límite hasta las 16:30. secret@example.com token=never-reflect', { state: 'limit', resetAt: at1630 }],
  ['rate-limit', 'Reset at 4:30 PM or 5:30 PM.', { state: 'limit', resetAt: null }]
]) {
  signal(signalCode, alertText, expected, localNow);
}

const previousTz = process.env.TZ;
try {
  process.env.TZ = 'America/New_York';

  signal(
    'rate-limit',
    'Usage limit reached. Try again at 1:30 AM.',
    { state: 'limit', resetAt: Date.parse('2024-11-03T06:30:00Z') },
    Date.parse('2024-11-03T06:15:00Z')
  );

  const nextValid0230 = Date.parse('2024-03-11T06:30:00Z');
  for (const nowMs of [
    Date.parse('2024-03-10T06:50:00Z'),
    Date.parse('2024-03-10T07:40:00Z')
  ]) {
    signal(
      'rate-limit',
      'Usage limit reached. Try again at 2:30 AM.',
      { state: 'limit', resetAt: nextValid0230 },
      nowMs
    );
  }
} finally {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
}

{
  const hidden = { signalCode: 'ready', alertText: null };
  Object.defineProperty(hidden, 'chatText', {
    value: 'private chat',
    enumerable: false
  });
  assert.deepEqual(classifyProviderPageSignal(hidden, () => localNow), UNKNOWN);
}
{
  const symbolKey = Symbol('secret');
  const symbolSignal = { signalCode: 'ready', alertText: null };
  symbolSignal[symbolKey] = 'private';
  assert.deepEqual(classifyProviderPageSignal(symbolSignal, () => localNow), UNKNOWN);
}

assert.deepEqual(
  classifyProviderPageSignal(
    { signalCode: 'rate-limit', alertText: 'Reset at 4:30 PM.' },
    () => { throw new Error('clock secret'); }
  ),
  UNKNOWN
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

(async () => {
  assert.throws(() => createProviderAccountStateReader({}), /dependencies/);
  assert.throws(
    () => createProviderAccountStateReader({
      readProviderSignal: async () => ({ signalCode: 'ready', alertText: null }),
      now: 123
    }),
    /dependencies/
  );

  const dependencies = {
    readProviderSignal: async () => ({ signalCode: 'ready', alertText: null }),
    now: () => localNow
  };
  const capturedReader = createProviderAccountStateReader(dependencies);
  dependencies.readProviderSignal = async () => ({
    signalCode: 'authentication',
    alertText: null
  });
  assert.deepEqual(
    await capturedReader.read(),
    { state: 'ready', resetAt: null }
  );

  const loginReader = createProviderAccountStateReader({
    readProviderSignal: async () => ({
      signalCode: 'authentication',
      alertText: null
    }),
    now: () => localNow
  });
  assert.deepEqual(
    await loginReader.read(),
    { state: 'requires_login', resetAt: null }
  );

  const sensitiveReader = createProviderAccountStateReader({
    readProviderSignal: async () => ({
      signalCode: 'rate-limit',
      alertText: 'Límite de uso. Inténtalo de nuevo a las 16:45. secret@example.com token=never-reflect'
    }),
    now: () => localNow
  });
  const sensitiveResult = await sensitiveReader.read();
  assert.deepEqual(sensitiveResult, { state: 'limit', resetAt: at1645 });
  const serializedReaderResult = JSON.stringify(sensitiveResult).toLowerCase();
  for (const forbidden of ['secret', 'email', 'token', 'never-reflect', 'alerttext']) {
    assert.equal(serializedReaderResult.includes(forbidden), false);
  }

  const hiddenExtraReader = createProviderAccountStateReader({
    readProviderSignal: async () => {
      const raw = { signalCode: 'ready', alertText: null };
      Object.defineProperty(raw, 'chatText', {
        value: 'private chat',
        enumerable: false
      });
      return raw;
    },
    now: () => localNow
  });
  assert.deepEqual(await hiddenExtraReader.read(), UNKNOWN);

  const symbolExtraReader = createProviderAccountStateReader({
    readProviderSignal: async () => {
      const raw = { signalCode: 'ready', alertText: null };
      raw[Symbol('secret')] = 'private';
      return raw;
    },
    now: () => localNow
  });
  assert.deepEqual(await symbolExtraReader.read(), UNKNOWN);

  const throwingReader = createProviderAccountStateReader({
    readProviderSignal: async () => {
      throw new Error('provider secret');
    },
    now: () => localNow
  });
  assert.deepEqual(await throwingReader.read(), UNKNOWN);

  const invalidClockReader = createProviderAccountStateReader({
    readProviderSignal: async () => ({ signalCode: 'ready', alertText: null }),
    now: () => Number.NaN
  });
  assert.deepEqual(await invalidClockReader.read(), UNKNOWN);

  console.log('factory-control account state contract: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
