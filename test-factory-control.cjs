const assert = require('node:assert/strict');
const protocol = require('./factory-control-protocol.js');
const heartbeat = () => ({
  profileAlias: 'chrome-pipe', accountAlias: 'dev-main',
  tabs: [{ tabId: 9, enabled: true, state: 'generating' }],
  accountState: { state: 'unknown', resetAt: null },
  lastEvent: 'cycle-complete'
});

assert.equal(protocol.VERSION, 1);
assert.deepEqual(protocol.heartbeat(heartbeat()), {
  version: 1, kind: 'heartbeat', profileAlias: 'chrome-pipe',
  accountAlias: 'dev-main',
  tabs: [{ tabId: 9, enabled: true, state: 'generating' }],
  accountState: { state: 'unknown', resetAt: null },
  lastEvent: 'cycle-complete'
});
assert.equal(protocol.heartbeat({ ...heartbeat(), lastEvent: undefined }).lastEvent, null);
assert.deepEqual(
  protocol.heartbeat({
    ...heartbeat(),
    accountState: { state: 'limit', resetAt: 1900000000000 }
  }).accountState,
  { state: 'limit', resetAt: 1900000000000 }
);
for (const accountState of [
  { state: 'ready', resetAt: 1900000000000 },
  { state: 'requires_login', resetAt: 1 },
  { state: 'limit', resetAt: 0 },
  { state: 'limit', resetAt: 'later' },
  { state: 'made_up', resetAt: null },
  { state: 'limit' },
  { state: 'limit', resetAt: null, message: 'private chat text' }
]) {
  assert.throws(() => protocol.heartbeat({ ...heartbeat(), accountState }), /account state|unsupported/i);
}
assert.throws(() => protocol.heartbeat({ ...heartbeat(), accountAlias: 'name@example.com' }), /alias/);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), token: 'secret' }), /unsupported/);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), lastEvent: 'chat text: private' }), /event/);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), tabs: Array(41).fill({ tabId: 1, enabled: true, state: 'waiting' }) }), /tabs/);
assert.deepEqual(protocol.heartbeat({ ...heartbeat(), tabs: [] }).tabs, []);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), tabs: Array(1) }), /Sparse tab/);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), tabs: [
  { tabId: 7, enabled: true, state: 'waiting' }, ,
  { tabId: 9, enabled: true, state: 'paused' }
] }), /Sparse tab/);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), tabs: [...heartbeat().tabs, ...heartbeat().tabs] }), /Duplicate/);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), tabs: [{ tabId: 1, enabled: true, state: 'unknown' }] }), /metadata/);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), tabs: [{ tabId: 1, enabled: true, state: 'waiting', chatText: 'private' }] }), /unsupported/);

assert.deepEqual(protocol.command({ id: 'abc-12', action: 'pause', target: 'all' }), {
  version: 1, kind: 'command', id: 'abc-12', action: 'pause', target: 'all', payload: null
});
assert.deepEqual(protocol.command({ id: 'm-02', action: 'set_mode', target: 9, payload: { mode: 'work' } }).payload, { mode: 'work' });
assert.equal(protocol.command({ id: 'send_3', action: 'send_message', target: 9, payload: { text: 'seguir' } }).payload.text, 'seguir');
assert.deepEqual(protocol.command({ id: 'bulk01', action: 'resume', target: 'all' }).target, 'all');
assert.throws(() => protocol.command({ id: 'bulk02', action: 'send_message', target: 'all', payload: { text: 'seguir' } }), /Broadcast/);
assert.throws(() => protocol.command({ id: 'bulk03', action: 'open_chat', target: 'all' }), /Broadcast/);
assert.throws(() => protocol.command({ id: 'bulk04', action: 'set_prompt', target: 'all', payload: { text: 'seguir' } }), /Broadcast/);
assert.throws(() => protocol.command({ id: 'bulk05', action: 'set_mode', target: 'all', payload: { mode: 'chat' } }), /Broadcast/);
assert.throws(() => protocol.command({ id: '1', action: 'delete_account', target: 9 }), /Unsupported/);
assert.throws(() => protocol.command({ id: '', action: 'pause', target: 9 }), /ID/);
assert.throws(() => protocol.command({ id: '1', action: 'pause', target: '9' }), /tab ID/);
assert.throws(() => protocol.command({ id: '1', action: 'pause', target: 9, payload: { text: 'secret' } }), /Unexpected/);
assert.throws(() => protocol.command({ id: '1', action: 'set_mode', target: 9, payload: { mode: 'unsafe' } }), /mode/);
assert.throws(() => protocol.command({ id: '1', action: 'set_prompt', target: 9, payload: { text: ' ' } }), /length/);
assert.throws(() => protocol.command({ id: '1', action: 'send_message', target: 9, payload: { text: 'x'.repeat(16001) } }), /length/);
assert.throws(() => protocol.command({ id: '1', action: 'send_message', target: 9, payload: { text: 'ok', token: 'secret' } }), /unsupported/);

assert.deepEqual(protocol.acknowledgement({ id: 'cmd01', ok: true, code: 'ok' }), {
  version: 1, kind: 'ack', id: 'cmd01', ok: true, code: 'ok'
});
assert.deepEqual(protocol.acknowledgement({ id: 'cmd01', ok: false, code: 'not_ready' }).code, 'not_ready');
assert.throws(() => protocol.acknowledgement({ id: '1', ok: false, code: 'chat is private' }), /result/);
assert.throws(() => protocol.acknowledgement({ id: '1', ok: true, code: 'failed' }), /result/);
assert.throws(() => protocol.acknowledgement({ id: '1', ok: true, code: 'ok', message: 'private' }), /unsupported/);

const INSTANCE_ID = '123e4567-e89b-42d3-a456-426614174000';
const NOW = 1_800_000_000_000;
const v2Command = (overrides = {}) => ({
  version: 2,
  kind: 'command',
  id: 'v2-command',
  instanceId: INSTANCE_ID,
  action: 'pause',
  target: 'instance',
  issuedAt: NOW,
  expiresAt: NOW + 60_000,
  ...overrides
});

assert.equal(protocol.VERSION_2, 2);
assert.equal(protocol.MAX_INSTANCE_COMMAND_TTL_MS, 300000);
assert.deepEqual(protocol.presenceV2({
  version: 2,
  kind: 'presence',
  instanceId: INSTANCE_ID,
  enabled: true,
  tabs: [{ tabId: 7, enabled: true }, { tabId: 9, enabled: false }],
  observedAt: NOW
}), {
  version: 2,
  kind: 'presence',
  instanceId: INSTANCE_ID,
  enabled: true,
  tabs: [{ tabId: 7, enabled: true }, { tabId: 9, enabled: false }],
  observedAt: NOW
});
assert.deepEqual(protocol.commandV2(v2Command()), v2Command());
assert.deepEqual(protocol.commandV2(v2Command({
  id: 'tab-pause',
  target: 7
})).target, 7);
assert.deepEqual(protocol.acknowledgementV2({
  version: 2,
  kind: 'ack',
  id: 'v2-command',
  instanceId: INSTANCE_ID,
  ok: true,
  code: 'ok',
  enabled: false,
  appliedTabs: [7, 9]
}), {
  version: 2,
  kind: 'ack',
  id: 'v2-command',
  instanceId: INSTANCE_ID,
  ok: true,
  code: 'ok',
  enabled: false,
  appliedTabs: [7, 9]
});

for (const invalid of [
  v2Command({ instanceId: INSTANCE_ID.toUpperCase() }),
  v2Command({ action: 'send_message' }),
  v2Command({ target: 'all' }),
  v2Command({ issuedAt: NOW, expiresAt: NOW }),
  v2Command({ expiresAt: NOW + 300001 }),
  { ...v2Command(), payload: { text: 'private chat text' } },
  { ...v2Command(), accountId: 'private-account' }
]) {
  assert.throws(() => protocol.commandV2(invalid), /v2|instance|tab|shape/i);
}
assert.throws(() => protocol.presenceV2({
  version: 2,
  kind: 'presence',
  instanceId: INSTANCE_ID,
  enabled: true,
  tabs: [{ tabId: 1, enabled: true, url: 'https://private.example/chat' }],
  observedAt: NOW
}), /shape/);
assert.throws(() => protocol.presenceV2({
  version: 2,
  kind: 'presence',
  instanceId: INSTANCE_ID,
  enabled: true,
  tabs: [{ tabId: 1, enabled: true }, { tabId: 1, enabled: false }],
  observedAt: NOW
}), /duplicate/);

const symbolExtra = v2Command();
symbolExtra[Symbol('secret')] = 'hidden';
assert.throws(() => protocol.commandV2(symbolExtra), /shape/);
const nonEnumerable = v2Command();
Object.defineProperty(nonEnumerable, 'hidden', { value: 'private', enumerable: false });
assert.throws(() => protocol.commandV2(nonEnumerable), /shape/);
const accessor = v2Command();
Object.defineProperty(accessor, 'action', { enumerable: true, get: () => 'pause' });
assert.throws(() => protocol.commandV2(accessor), /data fields/);
assert.throws(() => protocol.acknowledgementV2({
  version: 2,
  kind: 'ack',
  id: 'v2-command',
  instanceId: INSTANCE_ID,
  ok: true,
  code: 'failed',
  enabled: false,
  appliedTabs: []
}), /acknowledgement v2/);
assert.throws(() => protocol.acknowledgementV2({
  version: 2,
  kind: 'ack',
  id: 'v2-command',
  instanceId: INSTANCE_ID,
  ok: false,
  code: 'unauthorized',
  enabled: false,
  appliedTabs: [7, 7]
}), /duplicate/);

console.log('Factory Control protocol: heartbeat, command and ACK allowlists correct');
console.log('Factory Control v2 protocol: exact, instance-scoped and data-minimized');
require('./test-factory-governance.cjs');
require('./test-release-workflow.cjs');
