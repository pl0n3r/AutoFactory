const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const safari = path.join(__dirname, 'safari', 'ChatGPT Autopilot Local Extension', 'Resources');
for (const file of ['background.js', 'content.js', 'manifest.json']) {
  assert.equal(
    fs.readFileSync(path.join(safari, file), 'utf8'),
    fs.readFileSync(path.join(__dirname, file), 'utf8'),
    'Safari mirror diverged: ' + file
  );
}
const store = { diagnosticLog: [{
  at: new Date().toISOString(), event: 'legacy-private-free-text',
  tabId: 1, windowId: 2, path: '/c/old-secret',
  details: { message: 'legacy chat content', code: 'recoverable', token: 'legacy-token' }
}] };
let listener;
let rejectDiagnosticLogRead = false;
global.chrome = {
  storage: { local: {
    get(defaults, callback) {
      if (rejectDiagnosticLogRead && Object.hasOwn(defaults, 'diagnosticLog')) {
        throw new Error('PRIVATE-LOG-ERROR-SENTINEL');
      }
      callback({ ...defaults, ...store });
    },
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
      // AF152: exercise the real background listener and storage, without chat or browser.
      const fakeSender = { tab: { id: 27, windowId: 2,
        url: 'https://chatgpt.com/c/PRIVATE-SEND-DIAGNOSTIC-ID' } };
      const composer = { path: '/c/PRIVATE-SEND-DIAGNOSTIC-ID',
        textareas: 1, editable: 1, textboxes: 1, forms: 1 };
      const button = (disabled) => ({
        ariaLabel: 'PRIVATE-DOM-ATTRIBUTE', testId: 'PRIVATE-DOM-TEST-ID',
        title: 'PRIVATE-DOM-TITLE', type: 'submit', disabled
      });
      listener({ type: 'autopilot:log', event: 'send-control-missing',
        details: { controls: [button(false), button(true)], composer } },
      fakeSender, () => {});
      // The same numbers on another event are NOT allowlisted.
      listener({ type: 'autopilot:log', event: 'status',
        details: { code: 'safe', sendControlCount: 99, sendDisabledCount: 8,
          composerFieldCount: 300, token: 'PRIVATE' } },
      fakeSender, () => {});
      // Strict booleans and finite counts are required, no partial diagnostic.
      listener({ type: 'autopilot:log', event: 'send-control-missing',
        details: { controls: [button('true')], composer } },
      fakeSender, () => {});
      listener({ type: 'autopilot:log', event: 'send-control-missing',
        details: { controls: [button(false)],
          composer: { ...composer, editable: -1 } } },
      fakeSender, () => {});
      listener({ type: 'autopilot:log', event: 'send-control-missing',
        details: { controls: Array.from({ length: 13 }, () => button(false)), composer } },
      fakeSender, () => {});
      listener({ type: 'autopilot:log', event: 'send-control-missing',
        details: { controls: [button(false)],
          composer: { ...composer, forms: 5001 } } },
      fakeSender, () => {});
      const accessorButton = button(false);
      let accessorReads = 0;
      Object.defineProperty(accessorButton, 'disabled', { enumerable: true,
        get() { accessorReads += 1; return true; } });
      listener({ type: 'autopilot:log', event: 'send-control-missing',
        details: { controls: [accessorButton], composer } },
      fakeSender, () => {});
      assert.equal(accessorReads, 0, 'The background must never read raw DOM getters');
      listener({ type: 'autopilot:log', event: 'send-control-missing',
        details: { sendControlCount: 2, sendDisabledCount: 3, composerFieldCount: 1 } },
      fakeSender, () => {});
      // Incoming precomputed counts are not evidence of DOM controls.
      listener({ type: 'autopilot:log', event: 'send-control-missing',
        details: { sendControlCount: 12, sendDisabledCount: 12,
          composerFieldCount: 15000 } },
      fakeSender, () => {});
      listener({ type: 'autopilot:get-log' }, {}, result => {
        const matching = result.entries.filter(row => row.event === 'send-control-missing');
        assert.equal(matching.length, 8);
        assert.deepEqual(matching[0].details, {
          sendControlCount: 2, sendDisabledCount: 1, composerFieldCount: 3
        });
        console.log('AF152-COUNTS-OK');
        assert.deepEqual(result.entries.find(row =>
          row.event === 'status' && row.tabId === 27).details, { code: 'safe' });
        assert.deepEqual(matching[1].details, {});
        assert.deepEqual(matching[2].details, {});
        for (const rejected of matching.slice(3)) assert.deepEqual(rejected.details, {});
        const serialized = JSON.stringify(result.entries);
        for (const secret of ['PRIVATE-SEND-DIAGNOSTIC-ID', 'PRIVATE-DOM-ATTRIBUTE',
          'PRIVATE-DOM-TEST-ID', 'PRIVATE-DOM-TITLE', '"controls"', '"composer"', '"token"']) {
          assert.equal(serialized.includes(secret), false, 'Sensitive diagnostic leaked: ' + secret);
        }
        console.log('AF152-PRIVACY-OK');
        // Re-sanitize stored legacy diagnostics as well, preserving only verified counters.
        store.diagnosticLog = [
          { at: new Date().toISOString(), event: 'send-control-missing',
            path: '/c/PRIVATE-LEGACY-ROUTE',
            details: { sendControlCount: 2, sendDisabledCount: 1, composerFieldCount: 3 } },
          { at: new Date().toISOString(), event: 'send-control-missing',
            path: '/c/PRIVATE-LEGACY-ROUTE',
            details: { sendControlCount: 2, sendDisabledCount: 1,
              composerFieldCount: 3, title: 'PRIVATE-LEGACY-TITLE' } },
          { at: new Date().toISOString(), event: 'failure',
            details: { sendControlCount: 1, code: 'recoverable',
              email: 'private@example.invalid' } }
        ];
        listener({ type: 'autopilot:get-log' }, {}, legacy => {
          assert.equal(legacy.entries.length, 3);
          assert.deepEqual(legacy.entries[0].details,
            { sendControlCount: 2, sendDisabledCount: 1, composerFieldCount: 3 });
          assert.deepEqual(legacy.entries[1].details, {});
          assert.deepEqual(legacy.entries[2].details, { code: 'recoverable' });
          const output = JSON.stringify(legacy.entries);
          assert.equal(output.includes('PRIVATE-LEGACY-ROUTE'), false);
          assert.equal(output.includes('PRIVATE-LEGACY-TITLE'), false);
          assert.equal(output.includes('private@example.invalid'), false);
          console.log('AF152-MIRROR-LEGACY-OK');
          // The adapter may throw a message containing private data.
          // get-log must return a fixed error code rather than echoing it.
          rejectDiagnosticLogRead = true;
          listener({ type: 'autopilot:get-log' }, {}, denied => {
            assert.deepEqual(denied, { entries: [], error: 'storage_unavailable' });
            assert.equal(JSON.stringify(denied).includes('PRIVATE-LOG-ERROR-SENTINEL'), false);
            rejectDiagnosticLogRead = false;
            console.log('AF152-GETLOG-ERROR-REDACTED');
          });
        });
      });

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
