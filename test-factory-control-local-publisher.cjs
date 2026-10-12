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
  assert.deepEqual(Object.keys(api.payloadFrom(base)).sort((a, b) => a.localeCompare(b)),
    ['chats_open', 'idle_reason', 'instance_id', 'label', 'state'].sort((a, b) => a.localeCompare(b)));
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
  assert.deepEqual(Object.keys(calls[0]).sort((a, b) => a.localeCompare(b)),
    ['chats_open', 'current_task', 'idle_reason', 'idle_since',
      'instance_id', 'label', 'state'].sort((a, b) => a.localeCompare(b)));
  for (const forbidden of ['chat_text', 'prompt', 'https://', 'password',
    'email', 'cookie', 'token', 'title', 'account_id']) {
    assert.equal(transmitted.includes(forbidden), false, forbidden);
  }
  assert.equal(calls[0].current_task, 'Factory#562');
}
async function testServiceWorkerGate() {
  let signalChanged;
  let alarmListener;
  let enabled = false;
  let allowed = false;
  let installedAlarms = 0;
  const posts = [];
  const stored = { factoryControlLocalPublishingEnabled: false };
  const storage = {
    get(defaults, callback) { callback({ ...defaults, ...stored }); },
    set(values, callback) { Object.assign(stored, values); callback?.(); }
  };
  const root = {
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    async fetch(url, options) {
      posts.push({ url, body: JSON.parse(options.body), options });
      return { ok: true };
    },
    chrome: {
      storage: { local: storage, onChanged: { addListener(fn) { signalChanged = fn; } } },
      permissions: { contains(_details, callback) { callback(allowed); },
        onRemoved: { addListener() {} } },
      tabs: {
        query(_filter, callback) { callback([{ id: 1 }]); },
        sendMessage(_id, _message, callback) { callback({ enabled: true,
          sensitive_chat_text: 'NEVER-TRANSMIT' }); }
      },
      alarms: {
        create(_name, options) {
          assert.equal(options.periodInMinutes, 0.5);
          installedAlarms++;
          // Chrome MV3 intentionally does not call a callback.
        },
        clear(_name, callback) { callback?.(true); },
        onAlarm: { addListener(fn) { alarmListener = fn; } }
      },
      runtime: {
        onStartup: { addListener() {} }, onInstalled: { addListener() {} }
      }
    }
  };
  assert.equal(api.installBackground(root), true);
  await new Promise(setImmediate);
  assert.equal(installedAlarms, 0);
  assert.equal(posts.length, 0);
  // A storage flag without optional host permission still cannot send.
  enabled = true;
  stored.factoryControlLocalPublishingEnabled = enabled;
  signalChanged({ factoryControlLocalPublishingEnabled: { newValue: true } }, 'local');
  await new Promise(setImmediate);
  assert.equal(posts.length, 0);
  assert.equal(installedAlarms, 0);
  allowed = true;
  signalChanged({ factoryControlLocalPublishingEnabled: { newValue: true } }, 'local');
  await new Promise(setImmediate);
  assert.equal(installedAlarms, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, api.ENDPOINT);
  assert.equal(posts[0].body.state, 'activo');
  assert.equal(posts[0].body.chats_open, 1);
  assert.equal(JSON.stringify(posts).includes('NEVER-TRANSMIT'), false);
  assert.equal(posts[0].options.credentials, 'omit');
  alarmListener({ name: 'other-alarm' });
  await new Promise(setImmediate);
  assert.equal(posts.length, 1);
}

async function testSafariPromiseOnlyApis() {
  const stored = { factoryControlLocalPublishingEnabled: true };
  const posts = [];
  let alarmsCreated = 0;
  const expecting = (args, size) => { if (args.length !== size) throw new TypeError('No callbacks'); };
  const root = {
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    async fetch(url, options) {
      posts.push({ url, body: JSON.parse(options.body) });
      return { ok: true };
    },
    browser: {
      storage: {
        local: {
          get(...args) { expecting(args, 1); return Promise.resolve({ ...args[0], ...stored }); },
          set(...args) { expecting(args, 1); Object.assign(stored, args[0]); return Promise.resolve(); }
        },
        onChanged: { addListener() {} }
      },
      permissions: {
        contains(...args) { expecting(args, 1); return Promise.resolve(true); },
        onRemoved: { addListener() {} }
      },
      tabs: {
        query(...args) { expecting(args, 1); return Promise.resolve([{ id: 5 }]); },
        sendMessage(...args) {
          expecting(args, 2); return Promise.resolve({ enabled: false, private: 'SECRET' });
        }
      },
      alarms: {
        create(name, options) { assert.equal(options.periodInMinutes, 0.5);
          alarmsCreated++; return Promise.resolve(); },
        clear(...args) { expecting(args, 1); return Promise.resolve(true); },
        onAlarm: { addListener() {} }
      },
      runtime: { onStartup: { addListener() {} }, onInstalled: { addListener() {} } }
    }
  };
  assert.equal(api.installBackground(root), true);
  await new Promise(setImmediate);
  assert.equal(alarmsCreated, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.state, 'inactivo');
  assert.equal(JSON.stringify(posts).includes('SECRET'), false);
}

async function ac03() {
  const { calls, pub } = withPorts({ active: false });
  assert.equal(await pub.publish(), false);
  assert.equal(calls.length, 0);
  const denied = withPorts({ granted: false });
  assert.equal(await denied.pub.publish(), false);
  assert.equal(denied.calls.length, 0);
  await testServiceWorkerGate();
  await testSafariPromiseOnlyApis();
}
async function testRevokedConsentBeforePost() {
  let active = true;
  let granted = true;
  let posts = 0;
  const publisher = api.createPublisher({
    now: () => 150_000,
    enabled: async () => active,
    permission: async () => granted,
    snapshot: async () => { active = false; return base; },
    post: async () => { posts++; return true; }
  });
  assert.equal(await publisher.publish(), false);
  assert.equal(posts, 0);
  const revoked = api.createPublisher({
    now: () => 150_000,
    enabled: async () => true,
    permission: async () => granted,
    snapshot: async () => { granted = false; return base; },
    post: async () => { posts++; return true; }
  });
  assert.equal(await revoked.publish(), false);
  assert.equal(posts, 0);
}

async function ac04() {
  await testRevokedConsentBeforePost();
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
(async () => {
  await Promise.all(selected.map(key => {
    if (!Object.hasOwn(cases, key)) throw new Error('unknown AC');
    return cases[key]();
  }));
  console.log('Factory local publisher ' + selected.join(',') + ': PASS');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
