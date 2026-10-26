'use strict';

/** Pure, offline per-tab progress classifier; never reads conversation data. */
const STATES = Object.freeze({
  ACTIVE: 'ACTIVA',
  NO_PROGRESS: 'SIN_AVANCE',
  UNKNOWN: 'UNKNOWN'
});
const OPAQUE_DIGEST = /^[a-f0-9]{64}$/;
const TECHNICAL_FIELDS = Object.freeze([
  'nowMs', 'lastActivityAtMs', 'fingerprintStableSinceMs', 'thresholdMs',
  'previousFingerprint', 'fingerprint', 'activityObserved'
]);

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function classifyTabProgress(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return STATES.UNKNOWN;
  }

  // Inspect only own data descriptors; never invoke untrusted getters or read chat data.
  const values = Object.create(null);
  try {
    for (const field of TECHNICAL_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        if (field === 'activityObserved' && !descriptor) {
          values[field] = false;
          continue;
        }
        return STATES.UNKNOWN;
      }
      values[field] = descriptor.value;
    }
  } catch {
    // A Proxy may throw while describing a whitelisted field: fail closed.
    return STATES.UNKNOWN;
  }

  const {
    nowMs,
    lastActivityAtMs,
    fingerprintStableSinceMs,
    thresholdMs,
    previousFingerprint,
    fingerprint,
    activityObserved
  } = values;

  if (!validTime(nowMs) || !validTime(lastActivityAtMs) ||
      !validTime(fingerprintStableSinceMs) ||
      !validTime(thresholdMs) || thresholdMs < 1 ||
      lastActivityAtMs > nowMs || fingerprintStableSinceMs > nowMs ||
      typeof previousFingerprint !== 'string' ||
      typeof fingerprint !== 'string' ||
      !OPAQUE_DIGEST.test(previousFingerprint) ||
      !OPAQUE_DIGEST.test(fingerprint) ||
      typeof activityObserved !== 'boolean') {
    return STATES.UNKNOWN;
  }

  if (activityObserved || previousFingerprint !== fingerprint) {
    return STATES.ACTIVE;
  }

  const lastProgressAtMs = Math.max(lastActivityAtMs, fingerprintStableSinceMs);
  return nowMs - lastProgressAtMs >= thresholdMs
    ? STATES.NO_PROGRESS
    : STATES.ACTIVE;
}

module.exports = Object.freeze({ STATES, classifyTabProgress });
