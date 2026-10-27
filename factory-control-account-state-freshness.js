/* Offline account capacity preview. Not wired to browser, transport or service worker. */
(function (root, make) {
  'use strict';
  const api = make();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryAccountStateFreshness = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const MAX_AGE_MS = 300000;
  const MAX_BATCH = 16;
  const MAX_RESET_AHEAD_MS = 7 * 86400000;
  const ORDER = Object.freeze({ ready: 0, error: 1, limit: 2, requires_login: 3 });
  const CODES = Object.freeze({
    ready: 'ready', authentication: 'requires_login',
    'rate-limit': 'limit', connection: 'error'
  });
  const REASONS = Object.freeze({
    ready: 'EXPLICIT_FRESH_READY', requires_login: 'SESSION_CLOSED',
    limit: 'USAGE_LIMIT', error: 'PROVIDER_ERROR'
  });

  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const owned = Reflect.ownKeys(value);
    return owned.length === keys.length &&
      owned.every(key => typeof key === 'string' && keys.includes(key)) &&
      keys.every(key => Object.hasOwn(value, key));
  }

  function denied(reason = 'UNVERIFIED', freshness = 'unknown') {
    return Object.freeze({
      state: 'unknown', canResume: false, freshness, reason
    });
  }

  function clock(now) {
    if (typeof now !== 'function') return null;
    const value = now();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function classify(raw, current) {
    if (!exact(raw, ['signalCode', 'observedAt', 'resetAt']) ||
        typeof raw.signalCode !== 'string' ||
        !Object.hasOwn(CODES, raw.signalCode) ||
        !Number.isSafeInteger(raw.observedAt) || raw.observedAt < 0 ||
        raw.observedAt > current) return null;
    if (raw.signalCode !== 'rate-limit' && raw.resetAt !== null) return null;
    if (raw.signalCode === 'rate-limit' && raw.resetAt !== null &&
        (!Number.isSafeInteger(raw.resetAt) || raw.resetAt < 0 ||
         raw.resetAt > current + MAX_RESET_AHEAD_MS)) return null;
    // Even an expired resetAt on a verified limit cannot announce recovery.
    return CODES[raw.signalCode];
  }

  function evaluate(input, now) {
    try {
      if (!exact(input, ['observations', 'previousObservedAt', 'maxAgeMs']) ||
          !Array.isArray(input.observations) ||
          input.observations.length < 1 || input.observations.length > MAX_BATCH ||
          !Number.isSafeInteger(input.maxAgeMs) ||
          input.maxAgeMs < 1 || input.maxAgeMs > MAX_AGE_MS ||
          (input.previousObservedAt !== null &&
           (!Number.isSafeInteger(input.previousObservedAt) ||
            input.previousObservedAt < 0))) return denied();
      const current = clock(now);
      if (current === null) return denied();
      let latestAt = -1;
      let states = [];
      const observations = input.observations;
      for (let i = 0; i < observations.length; i += 1) {
        const raw = observations[i];
        const state = classify(raw, current);
        if (state === null || raw.observedAt < latestAt) return denied();
        if (raw.observedAt > latestAt) {
          states = [];
          latestAt = raw.observedAt;
        }
        states.push(state);
      }
      if (current - latestAt > input.maxAgeMs) {
        return denied('STALE_OBSERVATION', 'stale');
      }
      if (input.previousObservedAt !== null &&
          latestAt <= input.previousObservedAt) {
        return denied('REPLAYED_OBSERVATION');
      }
      // Contradictory duplicate observations at one instant fail closed.
      if (states.length !== new Set(states).size) return denied('AMBIGUOUS_SIMULTANEOUS');
      const state = states.reduce((a, b) => ORDER[a] >= ORDER[b] ? a : b);
      return Object.freeze({
        state, canResume: state === 'ready', freshness: 'fresh',
        reason: REASONS[state]
      });
    } catch (_error) { // No signal, clock or input detail may escape the boundary.
      return denied();
    }
  }

  return Object.freeze({ evaluate });
});
