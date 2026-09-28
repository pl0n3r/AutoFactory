(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryAccountState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATES = Object.freeze(['ready', 'limit', 'requires_login', 'error', 'unknown']);
  const MAX_RESET_FUTURE_MS = 7 * 24 * 60 * 60 * 1000;

  function exactObject(value, fields) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every(field => Object.hasOwn(value, field));
  }

  function classifyAccountState(input, now = Date.now) {
    if (!exactObject(input, ['authenticated', 'usageLimited', 'providerError', 'resetAt'])) {
      throw new TypeError('Invalid account state signal');
    }
    if (typeof input.authenticated !== 'boolean' ||
        typeof input.usageLimited !== 'boolean' ||
        typeof input.providerError !== 'boolean' ||
        typeof now !== 'function') {
      throw new TypeError('Invalid account state signal');
    }

    let nowMs;
    try { nowMs = now(); } catch (_error) { return Object.freeze({ state: 'unknown', resetAt: null }); }
    if (!Number.isSafeInteger(nowMs)) return Object.freeze({ state: 'unknown', resetAt: null });

    if (input.providerError) {
      if (input.usageLimited || input.authenticated === false) {
        return Object.freeze({ state: 'unknown', resetAt: null });
      }
      return Object.freeze({ state: 'error', resetAt: null });
    }

    if (!input.authenticated) {
      if (input.usageLimited || input.resetAt !== null) {
        return Object.freeze({ state: 'unknown', resetAt: null });
      }
      return Object.freeze({ state: 'requires_login', resetAt: null });
    }

    if (input.usageLimited) {
      if (!Number.isSafeInteger(input.resetAt) ||
          input.resetAt <= nowMs ||
          input.resetAt > nowMs + MAX_RESET_FUTURE_MS) {
        return Object.freeze({ state: 'unknown', resetAt: null });
      }
      return Object.freeze({ state: 'limit', resetAt: input.resetAt });
    }

    if (input.resetAt !== null) return Object.freeze({ state: 'unknown', resetAt: null });
    return Object.freeze({ state: 'ready', resetAt: null });
  }

  return Object.freeze({ STATES, classifyAccountState });
});
