const assert = require('node:assert/strict');
const protocol = require('./factory-control-protocol.js');
const heartbeat = () => ({
  profileAlias: 'chrome-pipe', accountAlias: 'dev-main',
  tabs: [{ tabId: 9, enabled: true, state: 'generating' }],
  lastEvent: 'cycle-complete'
});

assert.equal(protocol.VERSION, 1);
assert.deepEqual(protocol.heartbeat(heartbeat()), {
  version: 1, kind: 'heartbeat', profileAlias: 'chrome-pipe',
  accountAlias: 'dev-main',
  tabs: [{ tabId: 9, enabled: true, state: 'generating' }],
  lastEvent: 'cycle-complete'
});
assert.equal(protocol.heartbeat({ ...heartbeat(), lastEvent: undefined }).lastEvent, null);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), accountAlias: 'name@example.com' }), /alias/);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), token: 'secret' }), /unsupported/);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), lastEvent: 'chat text: private' }), /event/);
assert.throws(() => protocol.heartbeat({ ...heartbeat(), tabs: Array(41).fill({ tabId: 1, enabled: true, state: 'waiting' }) }), /tabs/);
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
console.log('Factory Control protocol: heartbeat, command and ACK allowlists correct');
