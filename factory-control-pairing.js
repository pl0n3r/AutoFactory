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

  function createPersistedPairingContract({ pairing, credentialStore } = {}) {
    if (!pairing || typeof pairing.pair !== 'function' || typeof pairing.revoke !== 'function' ||
        !credentialStore || typeof credentialStore.save !== 'function' ||
        typeof credentialStore.remove !== 'function') {
      throw new TypeError('Persisted pairing dependencies are required');
    }

    async function pair(input) {
      if (!exactKeys(input, ['profileAlias', 'code']) ||
          !validAlias(input.profileAlias) || !validCode(input.code)) {
        return safeResult(false, 'invalid');
      }
      try {
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
          try {
            await pairing.revoke({
              profileAlias: input.profileAlias,
              credentialId: result.credential.id
            });
          } catch (_revokeError) {
            // Best-effort compensation only. The opaque handle still expires server-side.
          }
          return safeResult(false, 'failed');
        }
        return result;
      } catch (_error) {
        return safeResult(false, 'failed');
      }
    }

    async function revoke(input) {
      if (!exactKeys(input, ['profileAlias', 'credentialId']) ||
          !validAlias(input.profileAlias) || !validId(input.credentialId)) {
        return safeResult(false, 'invalid');
      }
      try {
        const result = checkedPairingResult(await pairing.revoke(input));
        if (!['revoked', 'not_found'].includes(result.code)) return result;
        try {
          await credentialStore.remove({
            profileAlias: input.profileAlias,
            id: input.credentialId
          });
        } catch (_error) {
          return safeResult(false, 'failed');
        }
        return result;
      } catch (_error) {
        return safeResult(false, 'failed');
      }
    }

    return Object.freeze({ pair, revoke });
  }

  return Object.freeze({ RESULT_CODES, createPairingContract, createPersistedPairingContract });
});
