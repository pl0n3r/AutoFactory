'use strict';

const REQUIRED_CHECKS = Object.freeze([
  'preflight',
  'publish',
  'chrome_smoke',
  'safari_smoke',
  'rollback',
]);

function verifyReleaseEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { verified: false, reason: 'evidence must be an object' };
  }

  const allowed = new Set(['tag', 'commit_sha', ...REQUIRED_CHECKS]);
  for (const key of Object.keys(evidence)) {
    if (!allowed.has(key)) {
      return { verified: false, reason: `unexpected evidence field: ${key}` };
    }
  }

  if (typeof evidence.tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(evidence.tag)) {
    return { verified: false, reason: 'invalid tag' };
  }
  if (typeof evidence.commit_sha !== 'string' || !/^[0-9a-f]{40}$/.test(evidence.commit_sha)) {
    return { verified: false, reason: 'invalid commit_sha' };
  }

  for (const check of REQUIRED_CHECKS) {
    if (evidence[check] !== 'success') {
      return { verified: false, reason: `${check} must be success` };
    }
  }

  return { verified: true, reason: 'all required release evidence is successful' };
}

module.exports = { REQUIRED_CHECKS, verifyReleaseEvidence };
