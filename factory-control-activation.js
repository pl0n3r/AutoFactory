(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryActivation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RESULT_CODES = Object.freeze([
    'ready', 'unpaired', 'consent_denied', 'legal_blocked', 'invalid', 'failed'
  ]);
  const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

  function exactObject(value, fields) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every(field => Object.hasOwn(value, field));
  }

  function alias(value) {
    return typeof value === 'string' && value.length >= 1 && value.length <= 64 &&
      value.trim() === value && !value.includes('@') &&
      /^[A-Za-z0-9._-]+$/.test(value);
  }

  function opaqueId(value) {
    return typeof value === 'string' && value.length >= 8 && value.length <= 128 &&
      /^[A-Za-z0-9._:-]+$/.test(value);
  }

  function decision(allowed, code) {
    if (allowed !== (code === 'ready') || !RESULT_CODES.includes(code)) {
      throw new TypeError('Invalid activation decision');
    }
    return Object.freeze({ allowed, code });
  }

  function checkedNow(now, previous = null) {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 ||
        (previous !== null && value < previous)) {
      throw new TypeError('Invalid activation clock');
    }
    return value;
  }

  function validExpiry(value, nowMs) {
    if (!Number.isSafeInteger(value) || value > nowMs + MAX_FUTURE_MS) {
      throw new TypeError('Invalid activation expiry');
    }
    return value > nowMs;
  }

  function pairingReady(value, profileAlias, nowMs) {
    if (!exactObject(value, ['profileAlias', 'id', 'expiresAt', 'revoked']) ||
        !alias(value.profileAlias) || !opaqueId(value.id) ||
        typeof value.revoked !== 'boolean') {
      throw new TypeError('Invalid verified pairing');
    }
    const active = validExpiry(value.expiresAt, nowMs);
    return value.profileAlias === profileAlias && value.revoked === false && active;
  }

  function consentReady(value, profileAlias, nowMs) {
    if (!exactObject(value, ['profileAlias', 'enabled', 'revoked', 'expiresAt']) ||
        !alias(value.profileAlias) ||
        typeof value.enabled !== 'boolean' ||
        typeof value.revoked !== 'boolean') {
      throw new TypeError('Invalid verified heartbeat consent');
    }
    const active = validExpiry(value.expiresAt, nowMs);
    return value.profileAlias === profileAlias &&
      value.enabled === true && value.revoked === false && active;
  }

  function legalReady(value, profileAlias, nowMs) {
    if (!exactObject(value, ['profileAlias', 'allowed', 'expiresAt']) ||
        !alias(value.profileAlias) || typeof value.allowed !== 'boolean') {
      throw new TypeError('Invalid verified legal gate');
    }
    const active = validExpiry(value.expiresAt, nowMs);
    return value.profileAlias === profileAlias && value.allowed === true && active;
  }

  function createActivationPreflight({
    loadVerifiedPairing,
    loadVerifiedHeartbeatConsent,
    loadVerifiedLegalGate,
    now = Date.now
  } = {}) {
    if (typeof loadVerifiedPairing !== 'function' ||
        typeof loadVerifiedHeartbeatConsent !== 'function' ||
        typeof loadVerifiedLegalGate !== 'function' ||
        typeof now !== 'function') {
      throw new TypeError('Activation preflight dependencies are required');
    }

    async function evaluate(input) {
      if (!exactObject(input, ['profileAlias']) || !alias(input.profileAlias)) {
        return decision(false, 'invalid');
      }

      try {
        const profileAlias = input.profileAlias;

        const pairing = await loadVerifiedPairing({ profileAlias });
        let current = checkedNow(now);
        if (pairing === null || pairing === undefined) {
          return decision(false, 'unpaired');
        }
        if (!pairingReady(pairing, profileAlias, current)) {
          return decision(false, 'unpaired');
        }

        const consent = await loadVerifiedHeartbeatConsent({ profileAlias });
        current = checkedNow(now, current);
        if (consent === null || consent === undefined) {
          return decision(false, 'consent_denied');
        }
        if (!consentReady(consent, profileAlias, current)) {
          return decision(false, 'consent_denied');
        }

        const legalGate = await loadVerifiedLegalGate({ profileAlias });
        current = checkedNow(now, current);
        if (legalGate === null || legalGate === undefined) {
          return decision(false, 'legal_blocked');
        }
        if (!legalReady(legalGate, profileAlias, current)) {
          return decision(false, 'legal_blocked');
        }

        // Re-check earlier snapshots against the latest trusted time so a slow
        // preflight cannot return ready with pairing/consent that expired mid-flight.
        if (!pairingReady(pairing, profileAlias, current)) {
          return decision(false, 'unpaired');
        }
        if (!consentReady(consent, profileAlias, current)) {
          return decision(false, 'consent_denied');
        }

        return decision(true, 'ready');
      } catch (_error) {
        // Never expose adapter errors, credential handles, aliases or gate details.
        return decision(false, 'failed');
      }
    }

    return Object.freeze({ evaluate });
  }

  return Object.freeze({ RESULT_CODES, MAX_FUTURE_MS, createActivationPreflight });
});
