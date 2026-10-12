'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdmissionGuard } = require('./session-keepalive-runtime.js');
const policy = require('./factory-control-session-keepalive.js');
const NOW = 3000;
function good() {
  return {
    revision: 3, enabled: true, reservation_valid: true, same_chat: true,
    account_open: true, lease_epoch: 7, account_epoch: 2, ui_epoch: 4,
    snapshot: {
      chat: { last_prompt_s: 1000, last_reply_s: 1100, last_activity_s: 1100,
        last_reply_chars: 42, msgs_hour: 1, state: 'inactivo',
        reservation_active: true, reply_complete: true, identical_read_count: 2 },
      account: { msgs_hour: 1, observed_limit_hour: 40, usage_limited: false },
      controls: { enabled: true, manual_pause: false, kill_switch_running: true,
        circuit_breaker_open: false, ambiguous_send: false, session_closed: false },
      history: { retries_s: [] }
    }
  };
}
function guard(readEvidence, now = () => NOW) {
  return createAdmissionGuard({ policy, readEvidence, now });
}
function snapshots(first, second = first) {
  let calls = 0;
  return () => ++calls === 1 ? first : second;
}

test('AC-01 default disabled and revocation', async () => {
  const valid = good();
  assert.equal((await guard(snapshots(valid)).assess()).status, 'eligible');
  for (const change of [
    x => { x.enabled = false; },
    x => { x.snapshot.controls.enabled = false; },
    x => { x.snapshot.controls.manual_pause = true; },
    x => { x.snapshot.controls.kill_switch_running = false; },
    x => { x.snapshot.controls.session_closed = true; },
    x => { x.snapshot.account.usage_limited = true; },
    x => { x.reservation_valid = false; },
    x => { x.account_open = false; },
    x => { x.same_chat = false; }
  ]) {
    const item = good(); change(item);
    assert.equal((await guard(snapshots(item)).assess()).status, 'denied');
  }
  const absent = good(); delete absent.enabled;
  assert.equal((await guard(snapshots(absent)).assess()).status, 'denied');
});

test('AC-02 two-phase stale evidence blocks', async () => {
  for (const change of [
    x => { x.lease_epoch += 1; },
    x => { x.account_epoch += 1; },
    x => { x.ui_epoch += 1; },
    x => { x.revision += 1; },
    x => { x.snapshot.chat.reservation_active = false; },
    x => { x.snapshot.account.msgs_hour = 9; },
    x => { x.snapshot.controls.manual_pause = true; }
  ]) {
    const first = good(), second = good(); change(second);
    assert.equal((await guard(snapshots(first, second)).assess()).status, 'denied');
  }
  let t = NOW;
  assert.equal((await guard(snapshots(good()), () => t++).assess()).status, 'denied');
  assert.equal((await guard(async () => { throw new Error('private token'); }).assess()).status, 'denied');
});

test('AC-03 concurrent candidates fail closed', async () => {
  let release;
  let calls = 0;
  const g = guard(async () => {
    calls++;
    if (calls === 2) await new Promise(resolve => { release = resolve; });
    return good();
  });
  const p1 = g.assess();
  // Let the first call reach its second asynchronous read.
  for (let i = 0; i < 4 && !release; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  const p2 = g.assess();
  release();
  const results = await Promise.all([p1, p2]);
  assert.deepEqual(results.map(x => x.status), ['denied', 'denied']);
  assert.equal((await g.assess()).status, 'denied');
  const one = guard(snapshots(good()));
  assert.equal((await one.assess()).status, 'eligible');
  assert.equal((await one.assess()).status, 'denied');
  const fail = guard(async () => { throw new Error('ambiguous claim'); });
  assert.equal((await fail.assess()).status, 'denied');
  assert.equal((await fail.assess()).status, 'denied');
});

test('AC-04 no runtime send or private output', async () => {
  const hostile = [
    x => { x.snapshot.chat.prompt = 'private content'; },
    x => { x.snapshot.account.account_id = 'private-account'; },
    x => { x.credential = 'secret'; },
    x => { x.snapshot.controls.url = 'https://somewhere.invalid'; },
    x => { Object.defineProperty(x, 'revision', { get() { throw new Error('private'); } }); },
    x => { x.snapshot.history.retries_s = [1, , 2]; },
    x => { x.snapshot.history.retries_s = [1, -1]; }
  ];
  for (const change of hostile) {
    const x = good(); change(x);
    const result = await guard(snapshots(x)).assess();
    assert.equal(result.status, 'denied');
    assert.deepEqual(Object.keys(result).sort(), ['reason', 'status']);
    assert.doesNotMatch(JSON.stringify(result), /private|token|secret|https|prompt|account_id/);
  }
  const fs = require('node:fs');
  const code = fs.readFileSync(require('node:path').join(__dirname, 'session-keepalive-runtime.js'), 'utf8');
  for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /\bdocument\./,
    /\blocalStorage\b/, /\bchrome\./, /\bbrowser\./, /\.click\s*\(/,
    /\bsendMessage\s*\(/, /\bsetInterval\s*\(/]) {
    assert.equal(re.test(code), false, 'Forbidden runtime effect: ' + re);
  }
  assert.equal((await guard(snapshots(good())).assess()).status, 'eligible');
});
