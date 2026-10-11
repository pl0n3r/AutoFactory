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
  const DEFAULT_MAX_AGE_MS = 180000;
  const HARD_MAX_AGE_MS = 300000;

  function fields(value, names) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== names.length) return false;
    return keys.every(key => typeof key === 'string' && names.includes(key) &&
      Object.prototype.propertyIsEnumerable.call(value, key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptors(value), key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
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
    if (!fields(value, ['state', 'observedAt'])) return unknown('invalid_evidence');
    const { state, observedAt } = value;
    if (typeof state !== 'string' || !ALLOWED_STATES[name].includes(state) ||
        !Number.isSafeInteger(observedAt) || observedAt < 0) {
      return unknown('invalid_evidence');
    }
    if (observedAt > nowMs) return unknown('future_evidence');
    if (nowMs - observedAt > maxAgeMs) return unknown('stale_evidence', 'stale');
    if (state === 'unknown') return unknown('unknown_state', 'fresh');

    const ready = (name === 'pairing' && state === 'paired') ||
      (name === 'heartbeat' && state === 'online') ||
      (name === 'orders' && state === 'ready') ||
      (name === 'account' && state === 'ready');
    return Object.freeze({
      state: ready ? 'ready' : 'blocked',
      freshness: 'fresh',
      reason: ready ? null : 'not_ready',
      observedAt
    });
  }

  function buildReadinessReport(input, options = {}) {
    // Malformed or accessor-backed options must never escape the diagnostic.
    let validOptions = false;
    let nowMs = null;
    let maxAgeMs = null;
    try {
      validOptions = fields(options, ['nowMs']) ||
        fields(options, ['nowMs', 'maxAgeMs']);
      if (validOptions) {
        nowMs = options.nowMs;
        maxAgeMs = Object.hasOwn(options, 'maxAgeMs')
          ? options.maxAgeMs : DEFAULT_MAX_AGE_MS;
      }
    } catch (_error) { validOptions = false; }
    const validClock = validOptions && Number.isSafeInteger(nowMs) && nowMs >= 0;
    const validAge = Number.isSafeInteger(maxAgeMs) &&
      maxAgeMs > 0 && maxAgeMs <= HARD_MAX_AGE_MS;
    let validInput = false;
    try { validInput = fields(input, SIGNALS); } catch (_error) { validInput = false; }

    const signals = {};
    for (const name of SIGNALS) {
      let value;
      try {
        if (validInput) value = input[name];
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
      ready: validInput && allFreshReady,
      signals: Object.freeze(signals)
    });
  }

  return Object.freeze({ SIGNALS, buildReadinessReport });
});
