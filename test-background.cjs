const assert = require('node:assert/strict');
const store = {};
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
  { type: 'autopilot:log', event: 'failure', details: { message: 'fixture' } },
  { tab: { id: 9, windowId: 3, url: 'https://chatgpt.com/c/private-id' } },
  () => {}
);
setImmediate(() => {
  listener({ type: 'autopilot:get-log' }, {}, result => {
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].event, 'failure');
    assert.equal(result.entries[0].tabId, 9);
    assert.equal(result.entries[0].path, '/c/private-id');
    assert.equal(JSON.stringify(result.entries).includes('chat content'), false);
    console.log('Diagnostic log: append, metadata and export correctos');
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
