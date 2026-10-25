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

  // Opaque handles never belong to public pairing results, even by JSON serialization.
  // A WeakMap keeps them reachable only by the trusted internal persistence boundary.
  const internalCredentialByResult = new WeakMap();
  // Public result objects are never sufficient to recover opaque credentials.
  // Only the exact trusted pairing instance can authorize internal persistence.
  const internalPairingOwner = new WeakMap();
  // Private one-operation audit bridge, never exposed via a public result.
  const internalPostIssueAudit = new WeakMap();
  function safeResult(ok, code, credential, owner) {
    const result = Object.freeze({ ok, code });
    if (credential && owner) {
      internalCredentialByResult.set(result, Object.freeze({ credential, owner }));
    }
    return result;
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
    // Snapshot the untrusted adapter's own data fields once. Accessors could
    // change challengeId after consumption, before credential issuance.
    const fields = ['challengeId', 'profileAlias', 'expiresAt', 'revoked', 'used'];
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Reflect.ownKeys(value).length !== fields.length) {
      throw new TypeError('Invalid verified pairing challenge');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (!fields.every(field => Object.hasOwn(descriptors, field) &&
        descriptors[field].enumerable && Object.hasOwn(descriptors[field], 'value'))) {
      throw new TypeError('Invalid verified pairing challenge');
    }
    const challengeId = descriptors.challengeId.value;
    const alias = descriptors.profileAlias.value;
    const expiresAt = descriptors.expiresAt.value;
    const revoked = descriptors.revoked.value;
    const used = descriptors.used.value;
    if (!validId(challengeId) || alias !== profileAlias ||
        !Number.isSafeInteger(expiresAt) ||
        typeof revoked !== 'boolean' || typeof used !== 'boolean' ||
        expiresAt > nowMs + MAX_CHALLENGE_FUTURE_MS) {
      throw new TypeError('Invalid verified pairing challenge');
    }
    return Object.freeze({ challengeId, profileAlias: alias, expiresAt, revoked, used });
  }

  function checkedCredential(value, profileAlias, nowMs) {
    // Issuer metadata is untrusted. Direct property access would execute
    // accessor getters after a remote credential may already exist.
    const fields = ['credentialId', 'profileAlias', 'expiresAt'];
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Reflect.ownKeys(value).length !== fields.length) {
      throw new TypeError('Invalid opaque credential');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (!fields.every(field => Object.hasOwn(descriptors, field) &&
        descriptors[field].enumerable && Object.hasOwn(descriptors[field], 'value'))) {
      throw new TypeError('Invalid opaque credential');
    }
    const id = descriptors.credentialId.value;
    const alias = descriptors.profileAlias.value;
    const expiry = descriptors.expiresAt.value;
    if (!validId(id) || alias !== profileAlias ||
        !Number.isSafeInteger(expiry) || expiry <= nowMs ||
        expiry > nowMs + MAX_CREDENTIAL_FUTURE_MS) {
      throw new TypeError('Invalid opaque credential');
    }
    return Object.freeze({ id, expiresAt: expiry });
  }

  // Snapshot request primitives before any await. Accessors and extra own
  // keys are not a trusted input: never invoke request getters after validation.
  function snapshotInput(input, fields) {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Reflect.ownKeys(input).length !== fields.length) return null;
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const snapshot = {};
      for (const [field, validate] of fields) {
        const descriptor = descriptors[field];
        if (!descriptor || !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            !validate(descriptor.value)) return null;
        Object.defineProperty(snapshot, field, {
          value: descriptor.value, enumerable: true, writable: false
        });
      }
      return Object.freeze(snapshot);
    } catch (_error) {
      return null;
    }
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

    const owner = Object.freeze({});

    async function compensatePostIssue(value, profileAlias, context) {
      // A remote issue may have succeeded before local metadata validation.
      // Never execute untrusted credential getters or revoke another profile.
      let credentialId = null;
      try {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const id = Object.getOwnPropertyDescriptor(value, 'credentialId');
          const alias = Object.getOwnPropertyDescriptor(value, 'profileAlias');
          if (id && alias && Object.hasOwn(id, 'value') &&
              Object.hasOwn(alias, 'value') &&
              validId(id.value) && alias.value === profileAlias) {
            credentialId = id.value;
          }
        }
      } catch (_error) {
        // Unverifiable identity: keep the outcome unknown, never guess.
      }
      const report = internalPostIssueAudit.get(context);
      async function journal(phase, outcome) {
        if (typeof report !== 'function') return;
        try { await report(phase, outcome); } catch (_error) {
          // Audit already has the pre-issuance eligible intent.
        }
      }
      await journal('attempt');
      let outcome = 'unknown';
      if (credentialId !== null) {
        try {
          const revoked = await revokeOpaqueCredential({ profileAlias, credentialId });
          if (revoked === true) outcome = 'revoked';
          else if (revoked === false) outcome = 'not_found';
        } catch (_error) {
          // Remote compensation may be ambiguous; never report revoked.
        }
      }
      await journal('result', outcome);
    }

    async function pair(input, auditContext = null) {
      const request = snapshotInput(input, [['profileAlias', validAlias], ['code', validCode]]);
      if (!request) return safeResult(false, 'invalid');

      let issuanceAttempted = false;
      let issuedValue = null;
      try {
        const nowMs = now();
        if (!Number.isSafeInteger(nowMs)) return safeResult(false, 'failed');

        const challenge = checkedChallenge(
          await loadVerifiedChallenge({ profileAlias: request.profileAlias }),
          request.profileAlias,
          nowMs
        );

        if (challenge.revoked) return safeResult(false, 'revoked');
        if (challenge.used) return safeResult(false, 'replayed');
        if (challenge.expiresAt <= nowMs) return safeResult(false, 'expired');

        const consumed = await consumeVerifiedChallenge({
          challengeId: challenge.challengeId,
          profileAlias: request.profileAlias,
          code: request.code
        });
        if (!['consumed', 'invalid', 'expired', 'replayed', 'revoked'].includes(consumed)) {
          return safeResult(false, 'failed');
        }
        if (consumed !== 'consumed') return safeResult(false, consumed);

        issuanceAttempted = true;
        issuedValue = await issueOpaqueCredential({
          challengeId: challenge.challengeId,
          profileAlias: request.profileAlias
        });
        const credentialNowMs = now();
        if (!Number.isSafeInteger(credentialNowMs)) throw new TypeError('Invalid post-issue clock');
        const credential = checkedCredential(
          issuedValue,
          request.profileAlias,
          credentialNowMs
        );
        return safeResult(true, 'paired', credential, owner);
      } catch (_error) {
        if (issuanceAttempted) {
          await compensatePostIssue(issuedValue, request.profileAlias, auditContext);
        }
        // Never expose an issued handle, clock value or adapter exception.
        return safeResult(false, 'failed');
      }
    }

    async function revoke(input) {
      const request = snapshotInput(input, [['profileAlias', validAlias], ['credentialId', validId]]);
      if (!request) return safeResult(false, 'invalid');
      try {
        const revoked = await revokeOpaqueCredential({
          profileAlias: request.profileAlias,
          credentialId: request.credentialId
        });
        if (revoked === true) return safeResult(true, 'revoked');
        if (revoked === false) return safeResult(false, 'not_found');
        return safeResult(false, 'failed');
      } catch (_error) {
        // Collapse remote/store adapter failures; never expose handle or exception text.
        return safeResult(false, 'failed');
      }
    }

    const contract = Object.freeze({ pair, revoke });
    internalPairingOwner.set(contract, owner);
    return contract;
  }


  function checkedPairingResult(value, trustedOwner = null) {
    // Never evaluate accessors on an untrusted pairing provider result.
    // Values are taken only from ordinary enumerable own data descriptors.
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Reflect.ownKeys(value).length !== 2) {
      throw new TypeError('Invalid pairing result');
    }
    const okField = Object.getOwnPropertyDescriptor(value, 'ok');
    const codeField = Object.getOwnPropertyDescriptor(value, 'code');
    if (!okField?.enumerable || !Object.hasOwn(okField, 'value') ||
        !codeField?.enumerable || !Object.hasOwn(codeField, 'value')) {
      throw new TypeError('Invalid pairing result');
    }
    const ok = okField.value, code = codeField.value;
    const paired = code === 'paired';
    const successful = code === 'paired' || code === 'revoked';
    // Forged enumerable handles are rejected. Only results from our own
    // createPairingContract can carry the private persistence capability.
    const record = paired ? internalCredentialByResult.get(value) : null;
    const credential = trustedOwner !== null && record?.owner === trustedOwner
      ? record.credential : null;
    if (typeof ok !== 'boolean' || !RESULT_CODES.includes(code) ||
        ok !== successful ||
        (paired && (!exactKeys(credential, ['id', 'expiresAt']) ||
          !validId(credential.id) || !Number.isSafeInteger(credential.expiresAt)))) {
      throw new TypeError('Invalid pairing result');
    }
    // Never return an adapter-owned object to public callers: it can have an
    // inherited toJSON/proxy surface even when its own data keys are minimal.
    return paired ? Object.freeze({ ok, code, credential }) : Object.freeze({ ok, code });
  }

  function createPersistedPairingContract({ pairing, credentialStore, auditStore } = {}) {
    if (!pairing || typeof pairing.pair !== 'function' || typeof pairing.revoke !== 'function' ||
        !credentialStore || typeof credentialStore.save !== 'function' ||
        typeof credentialStore.remove !== 'function') {
      throw new TypeError('Persisted pairing dependencies are required');
    }

    // This brand is internal; a copied/fake pairing provider cannot use a
    // public {ok,code} result as a credential retrieval capability.
    const trustedOwner = internalPairingOwner.get(pairing) ?? null;

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
      const request = snapshotInput(input, [['profileAlias', validAlias], ['code', validCode]]);
      if (!request) return safeResult(false, 'invalid');
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
        let result;
        if (trustedOwner !== null) {
          const context = Object.freeze({});
          internalPostIssueAudit.set(context, async (phase, outcome) =>
            auditStore.append(Object.freeze({
              event: 'pairing_compensation', phase, auditId,
              ...(phase === 'result' ? { outcome } : {})
            }))
          );
          try {
            result = checkedPairingResult(await pairing.pair(request, context), trustedOwner);
          } finally {
            internalPostIssueAudit.delete(context);
          }
        } else {
          result = checkedPairingResult(await pairing.pair(request), trustedOwner);
        }
        if (result.code !== 'paired') return result;
        const row = {
          profileAlias: request.profileAlias,
          id: result.credential.id,
          expiresAt: result.credential.expiresAt
        };
        // Only an explicit, durable adapter acknowledgment validates pairing.
        // A resolved false/undefined is as ambiguous as a thrown exception.
        let saved = false;
        try {
          saved = await credentialStore.save(row);
        } catch (_error) {
          saved = false;
        }
        if (saved !== true) {
          await recordCompensation({
            profileAlias: request.profileAlias,
            credentialId: result.credential.id
          }, auditId);
          return safeResult(false, 'failed');
        }
        return safeResult(true, 'paired');
      } catch (_error) { // NOSONAR: adapter details are intentionally collapsed to fixed public result codes.
        // Deliberately discard adapter exception details; the public contract exposes only fixed result codes.
        return safeResult(false, 'failed');
      }
    }

    async function revoke(input) {
      const request = snapshotInput(input, [['profileAlias', validAlias], ['credentialId', validId]]);
      if (!request) return safeResult(false, 'invalid');
      // Drop the caller-owned reference. The variable used by the downstream
      // revocation contract now points only to our immutable primitive copy.
      input = request;
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
          profileAlias: request.profileAlias,
          id: request.credentialId
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
