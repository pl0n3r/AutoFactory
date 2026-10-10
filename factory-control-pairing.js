(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryPairing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RESULT_CODES = Object.freeze([
    'paired', 'invalid', 'expired', 'replayed', 'revoked', 'not_found', 'failed'
  ]);
  const MAX_CHALLENGE_FUTURE_MS = 10 * 60 * 1000;
  const MAX_CREDENTIAL_FUTURE_MS = 24 * 60 * 60 * 1000;

  function exactKeys(value, fields) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every(field => Object.hasOwn(value, field));
  }

  function validAlias(value) {
    return typeof value === 'string' && value.length >= 1 && value.length <= 64 &&
      !value.includes('@') && /^[A-Za-z0-9._-]+$/.test(value);
  }

  function validId(value) {
    return typeof value === 'string' && value.length >= 8 && value.length <= 128 &&
      /^[A-Za-z0-9._:-]+$/.test(value);
  }

  function validCode(value) {
    return typeof value === 'string' && /^\d{6}$/.test(value);
  }

  function safeResult(ok, code, credential) {
    const result = { ok, code };
    if (credential) result.credential = credential;
    return Object.freeze(result);
  }

  // A random audit reference correlates concurrent operations without deriving
  // an identifier from a profile, pairing code or opaque credential.
  function newAuditId() {
    try {
      const id = globalThis.crypto?.randomUUID?.();
      return typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        ? id : null;
    } catch (_error) {
      return null;
    }
  }

  function checkedChallenge(value, profileAlias, nowMs) {
    const fields = ['challengeId', 'profileAlias', 'expiresAt', 'revoked', 'used'];
    if (!exactKeys(value, fields) ||
        !validId(value.challengeId) ||
        value.profileAlias !== profileAlias ||
        !Number.isSafeInteger(value.expiresAt) ||
        typeof value.revoked !== 'boolean' ||
        typeof value.used !== 'boolean') {
      throw new TypeError('Invalid verified pairing challenge');
    }
    if (value.expiresAt > nowMs + MAX_CHALLENGE_FUTURE_MS) {
      throw new TypeError('Invalid verified pairing challenge');
    }
    return value;
  }

  function checkedCredential(value, profileAlias, nowMs) {
    const fields = ['credentialId', 'profileAlias', 'expiresAt'];
    if (!exactKeys(value, fields) ||
        !validId(value.credentialId) ||
        value.profileAlias !== profileAlias ||
        !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= nowMs ||
        value.expiresAt > nowMs + MAX_CREDENTIAL_FUTURE_MS) {
      throw new TypeError('Invalid opaque credential');
    }
    return Object.freeze({
      id: value.credentialId,
      expiresAt: value.expiresAt
    });
  }

  function createPairingContract({
    loadVerifiedChallenge,
    consumeVerifiedChallenge,
    issueOpaqueCredential,
    revokeOpaqueCredential,
    now = Date.now
  } = {}) {
    if (typeof loadVerifiedChallenge !== 'function' ||
        typeof consumeVerifiedChallenge !== 'function' ||
        typeof issueOpaqueCredential !== 'function' ||
        typeof revokeOpaqueCredential !== 'function' ||
        typeof now !== 'function') {
      throw new TypeError('Pairing dependencies are required');
    }

    async function pair(input) {
      if (!exactKeys(input, ['profileAlias', 'code']) ||
          !validAlias(input.profileAlias) ||
          !validCode(input.code)) {
        return safeResult(false, 'invalid');
      }

      try {
        const nowMs = now();
        if (!Number.isSafeInteger(nowMs)) return safeResult(false, 'failed');

        const challenge = checkedChallenge(
          await loadVerifiedChallenge({ profileAlias: input.profileAlias }),
          input.profileAlias,
          nowMs
        );

        if (challenge.revoked) return safeResult(false, 'revoked');
        if (challenge.used) return safeResult(false, 'replayed');
        if (challenge.expiresAt <= nowMs) return safeResult(false, 'expired');

        const consumed = await consumeVerifiedChallenge({
          challengeId: challenge.challengeId,
          profileAlias: input.profileAlias,
          code: input.code
        });
        if (!['consumed', 'invalid', 'expired', 'replayed', 'revoked'].includes(consumed)) {
          return safeResult(false, 'failed');
        }
        if (consumed !== 'consumed') return safeResult(false, consumed);

        const credentialValue = await issueOpaqueCredential({
          challengeId: challenge.challengeId,
          profileAlias: input.profileAlias
        });
        const credentialNowMs = now();
        if (!Number.isSafeInteger(credentialNowMs)) return safeResult(false, 'failed');
        const credential = checkedCredential(
          credentialValue,
          input.profileAlias,
          credentialNowMs
        );
        return safeResult(true, 'paired', credential);
      } catch (_error) {
        // Collapse pairing/storage adapter failures to the fixed public result.
        return safeResult(false, 'failed');
      }
    }

    async function revoke(input) {
      if (!exactKeys(input, ['profileAlias', 'credentialId']) ||
          !validAlias(input.profileAlias) ||
          !validId(input.credentialId)) {
        return safeResult(false, 'invalid');
      }
      try {
        const revoked = await revokeOpaqueCredential({
          profileAlias: input.profileAlias,
          credentialId: input.credentialId
        });
        if (revoked === true) return safeResult(true, 'revoked');
        if (revoked === false) return safeResult(false, 'not_found');
        return safeResult(false, 'failed');
      } catch (_error) {
        // Collapse remote/store adapter failures; never expose handle or exception text.
        return safeResult(false, 'failed');
      }
    }

    return Object.freeze({ pair, revoke });
  }


  function checkedPairingResult(value) {
    const paired = value?.code === 'paired';
    const successful = ['paired', 'revoked'].includes(value?.code);
    const fields = paired ? ['ok', 'code', 'credential'] : ['ok', 'code'];
    if (!exactKeys(value, fields) || typeof value.ok !== 'boolean' ||
        !RESULT_CODES.includes(value.code) || value.ok !== successful ||
        (paired && (!exactKeys(value.credential, ['id', 'expiresAt']) ||
          !validId(value.credential.id) || !Number.isSafeInteger(value.credential.expiresAt)))) {
      throw new TypeError('Invalid pairing result');
    }
    return value;
  }

  function createPersistedPairingContract({ pairing, credentialStore, auditStore } = {}) {
    if (!pairing || typeof pairing.pair !== 'function' || typeof pairing.revoke !== 'function' ||
        !credentialStore || typeof credentialStore.save !== 'function' ||
        typeof credentialStore.remove !== 'function') {
      throw new TypeError('Persisted pairing dependencies are required');
    }

    async function recordCompensation(input, auditId) {
      // Once credential issuance has happened, remote revocation is a security
      // compensation even if the audit adapter is subsequently unavailable.
      // The 'eligible' intent was durably written before issuance.
      try {
        await auditStore.append(Object.freeze({
          event: 'pairing_compensation', phase: 'attempt', auditId
        }));
      } catch (_error) { // NOSONAR: compensation must not expose adapter errors.
        // Best effort after the durable pre-issuance safety record.
      }
      let outcome = 'unknown';
      try {
        const result = checkedPairingResult(await pairing.revoke(input));
        if (['revoked', 'not_found'].includes(result.code)) outcome = result.code;
      } catch (_error) {
        // Remote effect may be ambiguous; never claim success.
      }
      try {
        await auditStore.append(Object.freeze({
          event: 'pairing_compensation', phase: 'result', auditId, outcome
        }));
      } catch (_error) {
        // Keep the pre-issuance record and return failure to the caller.
      }
    }

    async function pair(input) {
      if (!exactKeys(input, ['profileAlias', 'code']) ||
          !validAlias(input.profileAlias) || !validCode(input.code)) {
        return safeResult(false, 'invalid');
      }
      // Reserve a sanitized compensating-action record BEFORE issuing a
      // credential; otherwise a failed local save could require an unlogged
      // remote revocation. Missing audit fails closed without issuing.
      if (!auditStore || typeof auditStore.append !== 'function') {
        return safeResult(false, 'failed');
      }
      const auditId = newAuditId();
      if (!auditId) return safeResult(false, 'failed');
      try {
        const recorded = await auditStore.append(Object.freeze({
          event: 'pairing_compensation', phase: 'eligible', auditId
        }));
        if (recorded !== true) return safeResult(false, 'failed');
        const result = checkedPairingResult(await pairing.pair(input));
        if (result.code !== 'paired') return result;
        const row = {
          profileAlias: input.profileAlias,
          id: result.credential.id,
          expiresAt: result.credential.expiresAt
        };
        try {
          await credentialStore.save(row);
        } catch (_error) {
          await recordCompensation({
            profileAlias: input.profileAlias,
            credentialId: result.credential.id
          }, auditId);
          return safeResult(false, 'failed');
        }
        return result;
      } catch (_error) { // NOSONAR: adapter details are intentionally collapsed to fixed public result codes.
        // Deliberately discard adapter exception details; the public contract exposes only fixed result codes.
        return safeResult(false, 'failed');
      }
    }

    async function revoke(input) {
      if (!exactKeys(input, ['profileAlias', 'credentialId']) ||
          !validAlias(input.profileAlias) || !validId(input.credentialId)) {
        return safeResult(false, 'invalid');
      }
      // Audit must be durable before a remote revocation is attempted. The
      // audit events never contain a profile, pairing code, or credential handle.
      if (!auditStore || typeof auditStore.append !== 'function') {
        return safeResult(false, 'failed');
      }
      try {
        const auditId = newAuditId();
        if (!auditId) return safeResult(false, 'failed');
        const intentRecorded = await auditStore.append(Object.freeze({
          event: 'pairing_revocation', phase: 'attempt', auditId
        }));
        if (intentRecorded !== true) return safeResult(false, 'failed');

        const result = checkedPairingResult(await pairing.revoke(input));
        if (!['revoked', 'not_found'].includes(result.code)) return result;

        const removed = await credentialStore.remove({
          profileAlias: input.profileAlias,
          id: input.credentialId
        });
        if (removed !== true) return safeResult(false, 'failed');

        const outcomeRecorded = await auditStore.append(Object.freeze({
          event: 'pairing_revocation', phase: 'result', auditId, outcome: result.code
        }));
        if (outcomeRecorded !== true) return safeResult(false, 'failed');
        return result;
      } catch (_error) { // NOSONAR: audit/remote/store details must never escape this boundary.
        // Deliberately discard remote/store exception details; handles and adapter messages are sensitive.
        return safeResult(false, 'failed');
      }
    }

    return Object.freeze({ pair, revoke });
  }

  return Object.freeze({ RESULT_CODES, createPairingContract, createPersistedPairingContract });
});
