'use strict';
const assert = require('node:assert/strict');
const { evaluate } = require('./factory-control-account-state-freshness.js');

const NOW = 1800000000000;
const clock = () => NOW;
const obs = (signalCode, observedAt = NOW, resetAt = null) =>
  ({ signalCode, observedAt, resetAt });
const fixture = (...observations) => ({
  observations, previousObservedAt: NOW - 60000, maxAgeMs: 180000
});
function result(...signals) { return evaluate(fixture(...signals), clock); }
function denied(output) { assert.equal(output.canResume, false); }

function ac01() {
  const ready = result(obs('ready'));
  assert.deepEqual(ready, {
    state: 'ready', canResume: true,
    freshness: 'fresh', reason: 'EXPLICIT_FRESH_READY'
  });
  // A simultaneous login close wins over an apparent session limit / ready.
  const closed = result(obs('ready'), obs('rate-limit'), obs('authentication'));
  assert.equal(closed.state, 'requires_login');
  denied(closed);
  const limited = result(obs('ready'), obs('rate-limit'));
  assert.equal(limited.state, 'limit');
  denied(limited);
  const expiredReset = result(obs('rate-limit', NOW, NOW - 1000));
  assert.equal(expiredReset.state, 'limit');
  denied(expiredReset);
  const pastLimit = evaluate({
    ...fixture(obs('rate-limit', NOW - 180001)),
    previousObservedAt: null
  }, clock);
  assert.equal(pastLimit.reason, 'STALE_OBSERVATION');
  denied(pastLimit);
  const staleLogin = evaluate({
    ...fixture(obs('authentication', NOW - 180001)),
    previousObservedAt: null
  }, clock);
  assert.equal(staleLogin.freshness, 'stale');
  denied(staleLogin);
  const replayReady = evaluate({
    ...fixture(obs('ready')), previousObservedAt: NOW
  }, clock);
  assert.equal(replayReady.reason, 'REPLAYED_OBSERVATION');
  denied(replayReady);
  // A fresh *new* ready observation can recover; elapsed time alone cannot.
  assert.equal(result(obs('rate-limit', NOW - 1000), obs('ready', NOW)).canResume, true);
  assert.equal(result(obs('rate-limit', NOW - 1000)).canResume, false);
  const expired = result(obs('rate-limit', NOW, NOW - 1));
  assert.equal(expired.state, 'limit');
  console.log('AC-01: ok');
}

function ac02() {
  for (const signalCode of [
    'límite de uso', 'login requerido', 'uso limitado / signed out',
    'logged out', 'ready_or_login', 'limit/login', 'READY', 'unknown'
  ]) {
    const output = result(obs(signalCode));
    assert.equal(output.state, 'unknown');
    denied(output);
  }
  for (const value of [
    {...fixture(obs('ready')), conversation: 'SECRET_FAKE_CHAT'},
    fixture({ ...obs('ready'), alertText: 'test@example.invalid' }),
    fixture(obs('ready', NOW + 1)),
    fixture(obs('ready', 'now')),
    fixture(obs('ready', NOW, 'tomorrow')),
    {...fixture(obs('ready')), maxAgeMs: 999999},
    {...fixture(obs('ready')), previousObservedAt: 'unknown'},
    fixture(obs('ready', NOW), obs('ready', NOW)),
    fixture(obs('ready', NOW), obs('rate-limit', NOW - 1))
  ]) {
    denied(evaluate(value, clock));
  }
  const hidden = fixture(obs('ready'));
  Object.defineProperty(hidden.observations[0], 'secret', {
    enumerable: false, value: 'SECRET_FAKE_CHAT'
  });
  denied(evaluate(hidden, clock));
  const withSymbol = fixture(obs('ready'));
  withSymbol.observations[0][Symbol('TOKEN')] = 'NEVER_REFLECT';
  denied(evaluate(withSymbol, clock));
  denied(evaluate(fixture(obs('ready')), () => { throw new Error('FAKE_SECRET'); }));
  const text = JSON.stringify(evaluate(fixture(obs('ready')), () => { throw Error('FAKE_SECRET'); }));
  assert.doesNotMatch(text, /SECRET|TOKEN|conversation|example\.invalid/);
  assert.deepEqual(result(obs('connection')), {
    state: 'error', canResume: false, freshness: 'fresh', reason: 'PROVIDER_ERROR'
  });
  console.log('AC-02: ok');
}

const which = process.argv[2];
if (which === 'AC-01') ac01();
else if (which === 'AC-02') ac02();
else if (which === undefined) { ac01(); ac02(); }
else { process.exitCode = 2; }
