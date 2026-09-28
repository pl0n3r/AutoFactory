(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryResponseConsent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PURPOSE = 'response_return';
  const MAX_FUTURE_MS = 60 * 60 * 1000;

  function exactObject(value, fields) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every(field => Object.hasOwn(value, field));
  }

  function alias(value) {
    return typeof value === 'string' && value.length >= 1 && value.length <= 64 &&
      !value.includes('@') && /^[A-Za-z0-9._-]+$/.test(value);
  }

  function decision(allowed, code) {
    return Object.freeze({ allowed, code });
  }

  function createResponseConsent({ loadVerifiedConsent, now = Date.now } = {}) {
    if (typeof loadVerifiedConsent !== 'function' || typeof now !== 'function') {
      throw new TypeError('Consent dependencies are required');
    }

    async function authorize(input) {
      try {
        if (!exactObject(input, ['profileAlias'])) {
          return decision(false, 'invalid');
        }

        const profileAlias = input.profileAlias;
        if (!alias(profileAlias)) {
          return decision(false, 'invalid');
        }
        const grant = await loadVerifiedConsent({ profileAlias });
        const nowMs = now();
        if (!Number.isSafeInteger(nowMs)) return decision(false, 'failed');
        if (!exactObject(grant, [
          'profileAlias', 'purpose', 'enabled', 'revoked', 'expiresAt'
        ])) return decision(false, 'denied');

        if (!alias(grant.profileAlias) ||
            grant.profileAlias !== profileAlias ||
            grant.purpose !== PURPOSE ||
            grant.enabled !== true ||
            grant.revoked !== false ||
            !Number.isSafeInteger(grant.expiresAt) ||
            grant.expiresAt <= nowMs ||
            grant.expiresAt > nowMs + MAX_FUTURE_MS) {
          return decision(false, 'denied');
        }

        return decision(true, 'allowed');
      } catch (_error) {
        return decision(false, 'failed');
      }
    }

    return Object.freeze({ authorize });
  }

  return Object.freeze({ PURPOSE, createResponseConsent });
});
