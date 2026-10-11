'use strict';
const assert = require('node:assert/strict');
const { buildReadinessReport } = require('./factory-control-readiness-report.js');
const NOW = 1_800_000_000_000;
const sample = () => ({
  pairing: { state: 'paired', observedAt: NOW - 30000 },
  heartbeat: { state: 'online', observedAt: NOW - 50000 },
  orders: { state: 'ready', observedAt: NOW - 10000 },
  account: { state: 'ready', observedAt: NOW - 20000 }
});
const report = input => buildReadinessReport(input, { nowMs: NOW });

function ac01() {
  const good = report(sample());
  assert.equal(good.ready, true);
  assert.equal(good.mode, 'offline_diagnostic_only');
  assert.deepEqual(Object.keys(good.signals), ['pairing','heartbeat','orders','account']);
  for (const signal of Object.values(good.signals)) {
    assert.equal(signal.freshness, 'fresh');
    assert.equal(signal.reason, null);
    assert.equal(signal.state, 'ready');
    assert.equal(typeof signal.observedAt, 'number');
  }
  const unknown = sample();
  unknown.heartbeat = { state: 'unknown', observedAt: NOW - 10000 };
  const result = report(unknown);
  assert.equal(result.ready, false);
  assert.equal(result.signals.heartbeat.state, 'UNKNOWN');
  assert.equal(result.signals.heartbeat.reason, 'unknown_state');
  assert.equal(result.signals.heartbeat.freshness, 'fresh');
  const missing = sample();
  delete missing.pairing;
  const missingReport = report(missing);
  assert.equal(missingReport.ready, false);
  assert.equal(missingReport.signals.pairing.reason, 'missing_evidence');
  for (const signal of Object.values(missingReport.signals)) {
    assert.ok(['fresh', 'unknown', 'stale'].includes(signal.freshness));
    if (signal.state === 'UNKNOWN') assert.ok(signal.reason);
  }
}

function ac02() {
  const sensitive = sample();
  const forbidden = [
    'private chat', 'prompt-secret', 'https://private.example/',
    'cookie-SECRET', 'account-12345', 'token-SECRET'
  ];
  sensitive.pairing = {
    ...sensitive.pairing, profileAlias: 'account-12345',
    secret: 'cookie-SECRET'
  };
  sensitive.heartbeat = {
    ...sensitive.heartbeat, chatText: 'private chat',
    url: 'https://private.example/'
  };
  sensitive.orders = { ...sensitive.orders, prompt: 'prompt-secret' };
  sensitive.account = { ...sensitive.account, token: 'token-SECRET' };
  const text = JSON.stringify(report(sensitive));
  for (const phrase of forbidden) assert.equal(text.includes(phrase), false);
  assert.equal(report(sensitive).ready, false);
  for (const signal of Object.values(report(sensitive).signals)) {
    assert.equal(signal.state, 'UNKNOWN');
    assert.equal(signal.reason, 'invalid_evidence');
  }
  const getter = sample();
  Object.defineProperty(getter.orders, 'state', {
    get() { throw new Error('private chat'); }, enumerable: true
  });
  assert.equal(report(getter).signals.orders.reason, 'invalid_evidence');
  assert.equal(JSON.stringify(report(getter)).includes('private chat'), false);
}

function ac03() {
  const old = sample();
  old.orders = { state: 'ready', observedAt: NOW - 180001 };
  const stale = report(old);
  assert.equal(stale.ready, false);
  assert.equal(stale.signals.orders.state, 'UNKNOWN');
  assert.equal(stale.signals.orders.freshness, 'stale');
  assert.equal(stale.signals.orders.reason, 'stale_evidence');

  const future = sample();
  future.account = { state: 'ready', observedAt: NOW + 1 };
  assert.equal(report(future).signals.account.reason, 'future_evidence');
  assert.equal(report(future).ready, false);
  const malformed = sample();
  malformed.pairing = { state: 'paired', observedAt: 'yesterday' };
  assert.equal(report(malformed).signals.pairing.reason, 'invalid_evidence');
  assert.equal(buildReadinessReport(sample(), { nowMs: -1 }).ready, false);
  for (const invalidOptions of [null, [], { nowMs: NOW, token: 'private-token' }]) {
    const result = buildReadinessReport(sample(), invalidOptions);
    assert.equal(result.ready, false);
    assert.equal(result.signals.orders.reason, 'invalid_clock_or_age');
    assert.equal(JSON.stringify(result).includes('private-token'), false);
  }
  // Proxy.get must never override validated data descriptor values.
  // All descriptors say unknown, even though subsequent reads claim readiness.
  const advertised = sample();
  for (const [name, healthy] of Object.entries({
    pairing: 'paired', heartbeat: 'online', orders: 'ready', account: 'ready'
  })) {
    advertised[name] = new Proxy(
      { state: 'unknown', observedAt: NOW - 1000 },
      { get(target, key, receiver) {
        return key === 'state' ? healthy : Reflect.get(target, key, receiver);
      } }
    );
  }
  const adversarial = report(advertised);
  assert.equal(adversarial.ready, false);
  for (const signal of Object.values(adversarial.signals)) {
    assert.equal(signal.state, 'UNKNOWN');
    assert.equal(signal.reason, 'unknown_state');
  }
  const rootSample = sample();
  const rootProxy = new Proxy(rootSample, {
    get(target, key, receiver) {
      if (key === 'heartbeat') return { state: 'online', observedAt: NOW };
      return Reflect.get(target, key, receiver);
    }
  });
  // This descriptor is UNKNOWN while a Proxy.get may inject an ONLINE row.
  rootSample.heartbeat = { state: 'unknown', observedAt: NOW - 1000 };
  const rootResult = report(rootProxy);
  assert.equal(rootResult.ready, false);
  assert.equal(rootResult.signals.heartbeat.reason, 'unknown_state');
  const clockProxy = new Proxy({ nowMs: -1 }, {
    get(target, key, receiver) {
      return key === 'nowMs' ? NOW : Reflect.get(target, key, receiver);
    }
  });
  const clockResult = buildReadinessReport(sample(), clockProxy);
  assert.equal(clockResult.ready, false);
  assert.equal(clockResult.signals.orders.reason, 'invalid_clock_or_age');

  const getterOptions = { get nowMs() { throw new Error('private-options'); } };
  const accessorReport = buildReadinessReport(sample(), getterOptions);
  assert.equal(accessorReport.ready, false);
  assert.equal(JSON.stringify(accessorReport).includes('private-options'), false);
  const disabled = buildReadinessReport(sample(), { nowMs: NOW, maxAgeMs: 300001 });
  assert.equal(disabled.ready, false);
  assert.equal(disabled.signals.orders.state, 'UNKNOWN');
}

const tests = { 'AC-01': ac01, 'AC-02': ac02, 'AC-03': ac03 };
if (require.main === module) {
  const name = process.argv[2];
  if (!Object.hasOwn(tests, name)) {
    process.stderr.write('unknown acceptance criterion\n');
    process.exitCode = 2;
  } else {
    tests[name]();
    process.stdout.write(name + ' PASS\n');
  }
}
module.exports = tests;
