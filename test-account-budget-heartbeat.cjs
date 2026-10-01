'use strict';
const assert = require('node:assert/strict');
const protocol = require('./factory-control-protocol.js');
const heartbeat = require('./factory-control-heartbeat.js');

const messageBudget = {
  windowMs: 3600000,
  budget: 40,
  sent: 7,
  remaining: 33,
  limitEvents: 1,
  highReasoningSends: 6,
  nextAllowedAt: 200000,
  source: 'default'
};
const base = {
  profileAlias: 'profile-1',
  accountAlias: 'primary',
  tabs: [{ tabId: 7, enabled: true, state: 'waiting' }],
  lastEvent: 'send-confirmed',
  accountState: { state: 'ready', resetAt: null }
};
const payload = heartbeat.buildHeartbeatSnapshot({ ...base, messageBudget });
assert.deepEqual(payload.messageBudget, messageBudget);
assert.equal(JSON.stringify(payload).includes('prompt'), false);
assert.equal(JSON.stringify(payload).includes('@'), false);
assert.throws(() => protocol.heartbeat({
  ...base,
  messageBudget: { ...messageBudget, rawText: 'forbidden' }
}));
assert.throws(() => protocol.heartbeat({
  ...base,
  messageBudget: { ...messageBudget, remaining: 34 }
}), /Invalid message budget/);
assert.throws(() => protocol.heartbeat({
  ...base,
  messageBudget: { ...messageBudget, budget: 513, remaining: 506 }
}), /Invalid message budget/);
assert.throws(() => heartbeat.buildHeartbeatSnapshot({
  ...base,
  messageBudget: { ...messageBudget, accountAlias: 'should-not-leave' }
}));
console.log('account-budget-heartbeat: ok');
