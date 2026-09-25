const assert = require('node:assert/strict');
const store = { diagnosticLog: [{
  at: new Date().toISOString(), event: 'legacy-private-free-text',
  tabId: 1, windowId: 2, path: '/c/old-secret',
  details: { message: 'legacy chat content', code: 'recoverable', token: 'legacy-token' }
}] };
let listener;
global.chrome = {
  storage: { local: {
    get(defaults, callback) { callback({ ...defaults, ...store }); },
    set(values, callback) { Object.assign(store, values); callback?.(); }
  } },
  runtime: { onMessage: { addListener(value) { listener = value; } } }
};
require('./background.js');
assert.equal(typeof listener, 'function');
listener(
  { type: 'autopilot:log', event: 'failure', details: {
    message: 'chat content token private', chatText: 'chat content',
    nested: { password: 'private' }, url: 'https://chatgpt.com/c/private-id',
    code: 'connection', action: 'reload', promptLength: 9, enabled: true,
    codeWithSecret: 'private'
  } },
  { tab: { id: 9, windowId: 3, url: 'https://chatgpt.com/c/private-id' } },
  () => {}
);
listener(
  { type: 'autopilot:log', event: 'chat content secret', details: { reason: 'private info', attempt: 2 } },
  { tab: { id: 10, windowId: 3, url: 'https://chatgpt.com/c/new-secret' } },
  () => {}
);
listener(
  { type: 'autopilot:log', event: 'recovery', details: { code: 'connection' } },
  { tab: { id: 11, windowId: 3, url: 'https://chatgpt.com.evil.test/c/evil' } },
  () => {}
);
setImmediate(() => {
  listener({ type: 'autopilot:get-log' }, {}, result => {
    assert.equal(result.entries.length, 4);
    assert.equal(result.entries[0].event, 'unknown');
    assert.equal(result.entries[0].path, '/c/:id');
    assert.deepEqual(result.entries[0].details, { code: 'recoverable' });
    assert.equal(result.entries[1].event, 'failure');
    assert.equal(result.entries[1].tabId, 9);
    assert.equal(result.entries[1].path, '/c/:id');
    assert.deepEqual(result.entries[1].details, {
      code: 'connection', action: 'reload', promptLength: 9, enabled: true
    });
    assert.equal(result.entries[2].event, 'unknown');
    assert.deepEqual(result.entries[2].details, { attempt: 2 });
    assert.equal(result.entries[3].path, '/other');
    const serialized = JSON.stringify(result.entries);
    for (const secret of ['private-id', 'old-secret', 'new-secret', 'legacy-token',
      'chat content', 'password', 'evil.test', 'private info']) {
      assert.equal(serialized.includes(secret), false, secret + ' leaked');
    }
    // Older entries must also be redacted on export without requiring append.
    store.diagnosticLog = [{ at: new Date().toISOString(), event: 'failure',
      path: '/c/stale-secret', details: { message: 'stale chat content', code: 'error' } }];
    listener({ type: 'autopilot:get-log' }, {}, sanitized => {
      assert.equal(sanitized.entries[0].path, '/c/:id');
      assert.deepEqual(sanitized.entries[0].details, { code: 'error' });
      assert.equal(JSON.stringify(sanitized.entries).includes('stale-secret'), false);
      console.log('Diagnostic log: redaction, technical metadata and legacy export correctos');
    });
  });
  listener({ type: 'autopilot:learning-event', event: 'cycle', durationMs: 1200 }, {}, first => {
    assert.equal(first.learning.cycles, 1);
    listener({ type: 'autopilot:learning-event', event: 'recovery' }, {}, second => {
      assert.equal(second.learning.cycles, 1);
      assert.equal(second.learning.recoveries, 1);
      console.log('Learning: eventos serializados sin sobrescribir contadores');
    });
  });
});
