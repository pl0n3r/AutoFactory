'use strict';

const assert = require('node:assert/strict');
const { verifyReleaseEvidence } = require('./scripts/verify-release-evidence.cjs');

const good = {
  tag: 'v1.6.7',
  commit_sha: '2c9d6889e95ddd4b78f16c8b574244e184e0448c',
  preflight: 'success',
  publish: 'success',
  chrome_smoke: 'success',
  safari_smoke: 'success',
  rollback: 'success',
};

assert.deepEqual(verifyReleaseEvidence(good), {
  verified: true,
  reason: 'all required release evidence is successful',
});

for (const field of ['preflight', 'publish', 'chrome_smoke', 'safari_smoke', 'rollback']) {
  const missing = { ...good };
  delete missing[field];
  assert.equal(verifyReleaseEvidence(missing).verified, false, `missing ${field} must fail closed`);

  const failed = { ...good, [field]: 'failure' };
  assert.equal(verifyReleaseEvidence(failed).verified, false, `${field}=failure must fail closed`);
}

assert.equal(verifyReleaseEvidence({ ...good, publish: 'skipped' }).verified, false);
assert.equal(verifyReleaseEvidence({ ...good, extra: 'success' }).verified, false);
assert.equal(verifyReleaseEvidence({ ...good, tag: 'latest' }).verified, false);
assert.equal(verifyReleaseEvidence({ ...good, commit_sha: 'short' }).verified, false);
assert.equal(verifyReleaseEvidence(null).verified, false);

console.log('Release evidence gate: fail-closed contract verified');
