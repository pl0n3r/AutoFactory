'use strict';
const assert = require('node:assert/strict');
const api = require('./factory-control-local-publisher.js');
const base = {
  instance_id: 'a0b1c2:local-profile', label: 'AutoFactory',
  state: 'activo', chats_open: 2, idle_reason: 'activo'
};
const withPorts = ({ value = base, send, active = true, granted = true, now } = {}) => {
  const calls = [];
  const pub = api.createPublisher({
    now: now || (() => 100000),
    enabled: async () => active,
    permission: async () => granted,
    snapshot: async () => value,
    post: async p => { calls.push(p); return send ? send(p) : true; }
  });
  return { calls, pub };
};
async function ac01() {
  assert.deepEqual(Object.keys(api.payloadFrom(base)).sort(),
    ['chats_open', 'idle_reason', 'instance_id', 'label', 'state'].sort());
  assert.throws(() => api.payloadFrom({ ...base, chat_text: 'SECRET-PROMPT' }),
    /unknown or missing/);
  let getterCalls = 0;
  assert.throws(() => api.payloadFrom({
    ...base, get current_task() { getterCalls++; return 'Factory#1'; }
  }), /getters forbidden/);
  assert.equal(getterCalls, 0);
  const { calls, pub } = withPorts({ value: { ...base, token: 'SECRET' } });
  assert.equal(await pub.publish(), false);
  assert.equal(calls.length, 0);
}
async function ac02() {
  const { calls, pub } = withPorts({ value: { ...base, current_task: 'Factory#562',
    idle_since: '2026-10-12T10:00:00.000Z' } });
  assert.equal(await pub.publish(), true);
  const transmitted = JSON.stringify(calls[0]);
  assert.deepEqual(Object.keys(calls[0]).sort(),
    ['chats_open', 'current_task', 'idle_reason', 'idle_since',
      'instance_id', 'label', 'state'].sort());
  for (const forbidden of ['chat_text', 'prompt', 'https://', 'password',
    'email', 'cookie', 'token', 'title', 'account_id']) {
    assert.equal(transmitted.includes(forbidden), false, forbidden);
  }
  assert.equal(calls[0].current_task, 'Factory#562');
}
async function ac03() {
  const { calls, pub } = withPorts({ active: false });
  assert.equal(await pub.publish(), false);
  assert.equal(calls.length, 0);
  const denied = withPorts({ granted: false });
  assert.equal(await denied.pub.publish(), false);
  assert.equal(denied.calls.length, 0);
}
async function ac04() {
  let tick = 120_000, attempts = 0, unrelated = 0;
  const { pub } = withPorts({ now: () => tick, send: () => {
    attempts++; throw new Error('SECRET-private-http-failure');
  } });
  assert.equal(await pub.publish(), false);
  assert.equal(attempts, 1);
  unrelated++;
  tick += 30_000;
  assert.equal(await pub.publish(), false);
  assert.equal(attempts, 1);
  tick += 30_000;
  assert.equal(await pub.publish(), false);
  assert.equal(attempts, 2);
  assert.equal(unrelated, 1);
}
async function ac05() {
  for (const state of ['limite', 'sesion_cerrada']) {
    const p = api.payloadFrom({ ...base, state,
      limit_resets_at: '2026-10-12T16:00:00Z' });
    assert.equal(p.limit_resets_at, '2026-10-12T16:00:00Z');
  }
  assert.equal('limit_resets_at' in api.payloadFrom({
    ...base, limit_resets_at: '2026-10-12T16:00:00Z' }), false);
}
async function ac06() {
  assert.equal(api.payloadFrom({ ...base, idle_reason: 'unverified' }).idle_reason,
    'desconocido');
  assert.equal(api.payloadFrom({ ...base, idle_since: 'bad' }).idle_since, undefined);
  assert.equal(api.payloadFrom({ ...base, state: 'unverified' }).state,
    'desconocido');
  const p = api.payloadFrom({ ...base, idle_reason: 'esperando_pacing',
    idle_since: '2026-10-12T12:00:00Z' });
  assert.equal(p.idle_reason, 'esperando_pacing');
  assert.equal(p.idle_since, '2026-10-12T12:00:00Z');
}
const cases = { ac01, ac02, ac03, ac04, ac05, ac06 };
const selected = process.argv[2] ? [process.argv[2]] : Object.keys(cases);
(async () => { for (const key of selected) {
  if (!Object.hasOwn(cases, key)) throw new Error('unknown AC');
  await cases[key]();
} console.log('Factory local publisher ' + selected.join(',') + ': PASS');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
