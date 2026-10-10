'use strict';
const assert = require('node:assert/strict');
const {
  SCHEMA_VERSION, MAX_BATCH_BYTES, ACTIONS, BUILT_IN_POLICY,
  sanitizeOutcome, sanitizeBatch, validatePolicySnapshot
} = require('./shared-learning-protocol.js');

const now = 1_800_000_000_000;
const valid = {
  eventId: 'event-12345678', installationId: 'install-12345678',
  browserFamily: 'chrome', extensionVersion: '1.6.29',
  problemCode: 'conversation-unavailable', interfaceState: 'error',
  action: 'retry', durationMs: 4000, attempt: 1, outcome: 'success',
  policyVersion: 2, observedAt: now - 1000,
  prompt: 'PRIVATE', url: 'https://chatgpt.com/c/private', conversationId: 'secret'
};
const clean = sanitizeOutcome(valid, now);
assert.deepEqual(Object.keys(clean), [
  'schemaVersion','eventId','installationId','browserFamily','extensionVersion',
  'problemCode','interfaceState','action','durationMs','attempt','outcome',
  'policyVersion','observedAt'
]);
assert.equal(clean.schemaVersion, SCHEMA_VERSION);
assert.equal(Object.isFrozen(clean), true);
assert.equal(JSON.stringify(clean).includes('PRIVATE'), false);
assert.equal(ACTIONS.has('open_replacement_chat'), true);
assert.throws(() => sanitizeOutcome({...valid, action:'click_anything'}, now), /action/);
assert.throws(() => sanitizeOutcome({...valid, problemCode:'bad value!'}, now), /problemCode/);
assert.throws(() => sanitizeOutcome({...valid, unexpected:'field'}, now), /unexpected/);
assert.throws(() => sanitizeBatch(Array(100).fill(valid), now), /batch/);
assert.ok(MAX_BATCH_BYTES <= 16 * 1024);

const policy = validatePolicySnapshot({
  schemaVersion: 1, policyVersion: 3, issuedAt: now - 1000,
  expiresAt: now + 60_000, enabled: true, rollbackVersion: 2,
  contexts: {
    'conversation-unavailable:error': {
      action: 'retry', confidence: 0.91, successRate: 0.88, samples: 25
    }
  }
}, now, 2);
assert.equal(policy.policyVersion, 3);
assert.equal(Object.isFrozen(policy.contexts), true);
assert.throws(() => validatePolicySnapshot({...policy, expiresAt:now-1}, now, 2), /expired/);
assert.throws(() => validatePolicySnapshot({...policy, policyVersion:1}, now, 2), /version/);
assert.throws(() => validatePolicySnapshot({...policy, contexts:{x:{action:'script',confidence:1,successRate:1,samples:100}}}, now, 2), /action/);
assert.equal(BUILT_IN_POLICY.enabled, false);
console.log('shared-learning protocol: privacy, schema and policy validation pass');
