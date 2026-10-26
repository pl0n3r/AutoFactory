'use strict';

const assert = require('node:assert/strict');
const { STATES, classifyTabProgress } = require('./local-tab-progress.js');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function fixture(overrides = {}) {
  return {
    nowMs: 1_000_000,
    lastActivityAtMs: 900_000,
    fingerprintStableSinceMs: 940_000,
    thresholdMs: 60_000,
    previousFingerprint: HASH_A,
    fingerprint: HASH_A,
    activityObserved: false,
    ...overrides
  };
}

function test_no_progress_requires_threshold_and_stable_fingerprint() {
  assert.equal(classifyTabProgress(fixture()), STATES.NO_PROGRESS,
    'stable digest plus elapsed threshold confirms a local lack of progress');
  assert.equal(classifyTabProgress(fixture({ fingerprintStableSinceMs: 940_001 })), STATES.ACTIVE,
    'one millisecond before threshold cannot be flagged');
  assert.equal(classifyTabProgress(fixture({ lastActivityAtMs: 970_000 })), STATES.ACTIVE,
    'recent activity must reset the threshold even with a stable digest');
  for (const changes of [
    { thresholdMs: 0 }, { thresholdMs: -1 }, { thresholdMs: Infinity },
    { thresholdMs: 60.5 }, { nowMs: NaN }, { nowMs: -1 },
    { lastActivityAtMs: 1_000_001 },
    { fingerprintStableSinceMs: 1_000_001 },
    { fingerprint: '' }, { fingerprint: 'plaintext chat' },
    { previousFingerprint: null },
    { activityObserved: 'yes' }
  ]) {
    assert.equal(classifyTabProgress(fixture(changes)), STATES.UNKNOWN,
      `invalid technical field must fail closed: ${Object.keys(changes)[0]}`);
  }
  for (const bad of [null, undefined, [], 4, '', {}]) {
    assert.equal(classifyTabProgress(bad), STATES.UNKNOWN);
  }
}

function test_fresh_activity_resets_state_and_excludes_chat_payload() {
  assert.equal(classifyTabProgress(fixture({ activityObserved: true })), STATES.ACTIVE);
  assert.equal(classifyTabProgress(fixture({ fingerprint: HASH_B })), STATES.ACTIVE);
  assert.equal(classifyTabProgress(fixture({ lastActivityAtMs: 999_999 })), STATES.ACTIVE);
  const input = Object.freeze(fixture());
  assert.equal(classifyTabProgress(input), STATES.NO_PROGRESS);

  const sensitive = fixture();
  for (const property of ['chatText', 'conversationId', 'cookie', 'token']) {
    Object.defineProperty(sensitive, property, {
      enumerable: true,
      get() { throw new Error(`attempt to read forbidden property: ${property}`); }
    });
  }
  const actual = classifyTabProgress(sensitive);
  assert.equal(actual, STATES.NO_PROGRESS);
  assert.equal(typeof actual, 'string', 'never echo the input or metadata');
  assert.equal(JSON.stringify(actual).includes(HASH_A), false,
    'even technical fingerprint must not be exposed in output');
}

const tests = {
  'AC-01': test_no_progress_requires_threshold_and_stable_fingerprint,
  'AC-02': test_fresh_activity_resets_state_and_excludes_chat_payload
};
const selected = process.argv[2];
if (selected && !Object.hasOwn(tests, selected)) {
  process.stderr.write('Unknown acceptance case\n');
  process.exitCode = 2;
} else {
  for (const name of selected ? [selected] : Object.keys(tests)) {
    tests[name]();
  }
  process.stdout.write(`${selected ? 1 : Object.keys(tests).length} offline acceptance test(s) passed\n`);
}
