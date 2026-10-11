(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryReadiness = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Pure, local diagnostic only. Never drives transport, pairing or commands.
  const SIGNALS = Object.freeze(['pairing', 'heartbeat', 'orders', 'account']);
  const ALLOWED_STATES = Object.freeze({
    pairing: Object.freeze(['paired', 'unpaired', 'revoked', 'unknown']),
    heartbeat: Object.freeze(['online', 'offline', 'unknown']),
    orders: Object.freeze(['ready', 'blocked', 'unknown']),
    account: Object.freeze(['ready', 'limit', 'requires_login', 'error', 'unknown'])
  });
  const READY_STATES = Object.freeze({
    pairing: 'paired', heartbeat: 'online', orders: 'ready', account: 'ready'
  });
  const DEFAULT_MAX_AGE_MS = 180000;
  const HARD_MAX_AGE_MS = 300000;

  function snapshotFields(value, names) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    // Never trust later Proxy.get results after validating property descriptors:
    // bind each field to the data descriptor's value in a single snapshot.
    const keys = Reflect.ownKeys(value);
    if (keys.length !== names.length) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const captured = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || !names.includes(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)?.value;
      if (!descriptor || descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) return null;
      captured[key] = descriptor.value;
    }
    return Object.freeze(captured);
  }

  function unknown(reason, freshness = 'unknown') {
    return Object.freeze({
      state: 'UNKNOWN', freshness, reason, observedAt: null
    });
  }

  function readEvidence(name, value, nowMs, maxAgeMs) {
    if (value === undefined || value === null) return unknown('missing_evidence');
    // Only sanitized observation envelopes are accepted. Raw module payloads
    // may carry account aliases, chat IDs or other user data: never copy them.
    const evidence = snapshotFields(value, ['state', 'observedAt']);
    if (!evidence) return unknown('invalid_evidence');
    const { state, observedAt } = evidence;
    if (typeof state !== 'string' || !ALLOWED_STATES[name].includes(state) ||
        !Number.isSafeInteger(observedAt) || observedAt < 0) {
      return unknown('invalid_evidence');
    }
    if (observedAt > nowMs) return unknown('future_evidence');
    if (nowMs - observedAt > maxAgeMs) return unknown('stale_evidence', 'stale');
    if (state === 'unknown') return unknown('unknown_state', 'fresh');

    const ready = READY_STATES[name] === state;
    return Object.freeze({
      state: ready ? 'ready' : 'blocked',
      freshness: 'fresh',
      reason: ready ? null : 'not_ready',
      observedAt
    });
  }

  function buildReadinessReport(input, options = {}) {
    // Malformed or accessor-backed options must never escape the diagnostic.
    let optionsSnapshot = null;
    let nowMs = null;
    let maxAgeMs = null;
    try {
      optionsSnapshot = snapshotFields(options, ['nowMs']) ||
        snapshotFields(options, ['nowMs', 'maxAgeMs']);
      if (optionsSnapshot) {
        nowMs = optionsSnapshot.nowMs;
        maxAgeMs = Object.hasOwn(optionsSnapshot, 'maxAgeMs')
          ? optionsSnapshot.maxAgeMs : DEFAULT_MAX_AGE_MS;
      }
    } catch (_error) {
      // Discard hostile Proxy errors; never reflect sensitive exception messages.
      optionsSnapshot = null;
    }
    const validClock = !!optionsSnapshot && Number.isSafeInteger(nowMs) && nowMs >= 0;
    const validAge = Number.isSafeInteger(maxAgeMs) &&
      maxAgeMs > 0 && maxAgeMs <= HARD_MAX_AGE_MS;
    let inputSnapshot = null;
    try { inputSnapshot = snapshotFields(input, SIGNALS); } catch (_error) {
      // Reject hostile Proxy descriptors, without reflecting their error text.
      inputSnapshot = null;
    }

    const signals = {};
    for (const name of SIGNALS) {
      try {
        const value = inputSnapshot ? inputSnapshot[name] : undefined;
        signals[name] = validClock && validAge
          ? readEvidence(name, value, nowMs, maxAgeMs)
          : unknown('invalid_clock_or_age');
      } catch (_error) {
        signals[name] = unknown('invalid_evidence');
      }
    }
    const allFreshReady = SIGNALS.every(name =>
      signals[name].state === 'ready' && signals[name].freshness === 'fresh');
    return Object.freeze({
      version: 1,
      mode: 'offline_diagnostic_only',
      ready: !!inputSnapshot && allFreshReady,
      signals: Object.freeze(signals)
    });
  }

  return Object.freeze({ SIGNALS, buildReadinessReport });
});
