'use strict';

// Offline-only. Exercise the existing pairing/persistence contracts with
// entirely fictitious, in-memory adapters; never wire this into extension runtime.
const { createPairingContract, createPersistedPairingContract } =
  require('./factory-control-pairing.js');

const NOW = 1_800_000_000_000;
const PROFILE = 'fixture-profile-01';
const CHALLENGE = 'fixture-challenge-01';
const PIN = '123456';
const HANDLE = 'fixture-opaque-handle-01';
const MODES = new Set(['revoked', 'consumed', 'expired', 'unknown']);

function publicState(state) {
  return Object.freeze({
    challengeConsumed: state.consumed === true,
    credentialStored: state.credential !== null,
    revoked: state.revoked === true,
    uncertain: state.uncertain === true
  });
}

function syntheticSession(state) {
  const pairing = createPairingContract({
    now: () => NOW,
    loadVerifiedChallenge: async ({ profileAlias }) => {
      if (state.uncertain) throw new TypeError('unavailable synthetic snapshot');
      return {
        challengeId: CHALLENGE,
        profileAlias,
        expiresAt: state.expired ? NOW - 1 : NOW + 60_000,
        revoked: state.revoked,
        used: state.consumed
      };
    },
    consumeVerifiedChallenge: async ({ code }) => {
      if (state.uncertain) return 'unknown';
      if (state.revoked) return 'revoked';
      if (state.consumed) return 'replayed';
      if (code !== PIN) return 'invalid';
      state.consumed = true;
      return 'consumed';
    },
    issueOpaqueCredential: async ({ profileAlias }) => ({
      credentialId: HANDLE, profileAlias, expiresAt: NOW + 3_600_000
    }),
    revokeOpaqueCredential: async ({ profileAlias, credentialId }) => {
      if (state.uncertain || state.revoked ||
          profileAlias !== PROFILE || state.credential?.id !== credentialId) return false;
      state.revoked = true;
      return true;
    }
  });

  // The adapter models the already-merged credential store without Chrome APIs.
  return createPersistedPairingContract({
    pairing,
    credentialStore: {
      save: async row => {
        if (state.uncertain || state.credential !== null ||
            row.profileAlias !== PROFILE || row.id !== HANDLE) return false;
        state.credential = { profileAlias: row.profileAlias, id: row.id, expiresAt: row.expiresAt };
        return true;
      },
      remove: async row => {
        if (state.uncertain || state.credential?.id !== row.id ||
            row.profileAlias !== PROFILE) return false;
        state.credential = null;
        return true;
      }
    },
    // Synthetic audit acknowledges only fixed event categories; stores no handles.
    auditStore: { append: async entry =>
      ['pairing_compensation', 'pairing_revocation'].includes(entry.event) }
  });
}

/** Replay a fictitious challenge against a newly constructed pairing session. */
async function simulateSyntheticRevokeReplay(mode) {
  if (typeof mode !== 'string' || !MODES.has(mode)) {
    return Object.freeze({ ok: false, code: 'invalid' });
  }

  let state = {
    consumed: false, revoked: false, credential: null,
    expired: false, uncertain: false
  };
  const initial = syntheticSession(state);
  let first = null;
  let revocation = null;
  if (mode === 'revoked' || mode === 'consumed') {
    first = await initial.pair({ profileAlias: PROFILE, code: PIN });
  }
  const before = publicState(state);

  if (mode === 'revoked') {
    revocation = await initial.revoke({ profileAlias: PROFILE, credentialId: HANDLE });
  } else if (mode === 'expired') {
    state.expired = true;
  } else if (mode === 'unknown') {
    state.uncertain = true;
  }

  // Simulated restart: only the *fictitious* durable backing store survives.
  state = structuredClone(state);
  const after = publicState(state);
  const replay = await syntheticSession(state).pair({
    profileAlias: PROFILE, code: PIN
  });
  return Object.freeze({ scenario: mode, before, after, first, revocation, replay });
}

module.exports = Object.freeze({ simulateSyntheticRevokeReplay });
