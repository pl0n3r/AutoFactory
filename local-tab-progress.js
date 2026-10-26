'use strict';

/** Pure, offline per-tab progress classifier; never reads conversation data. */
const STATES = Object.freeze({
  ACTIVE: 'ACTIVA',
  NO_PROGRESS: 'SIN_AVANCE',
  UNKNOWN: 'UNKNOWN'
});
const OPAQUE_DIGEST = /^[a-f0-9]{64}$/;

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function classifyTabProgress(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return STATES.UNKNOWN;
  }

  // Deliberately whitelist technical fields. Never read arbitrary chat payload.
  const {
    nowMs,
    lastActivityAtMs,
    fingerprintStableSinceMs,
    thresholdMs,
    previousFingerprint,
    fingerprint,
    activityObserved = false
  } = input;

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
