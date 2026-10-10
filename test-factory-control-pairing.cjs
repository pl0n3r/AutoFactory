'use strict';

const assert = require('node:assert/strict');
const { createPairingContract, createPersistedPairingContract } = require('./factory-control-pairing.js');

const NOW = 1_800_000_000_000;

function fixture(overrides = {}) {
  let used = false;
  let revoked = false;
  const calls = [];
  const contract = createPairingContract({
    now: () => NOW,
    loadVerifiedChallenge: async ({ profileAlias }) => ({
      challengeId: 'challenge-001',
      profileAlias,
      expiresAt: NOW + 60_000,
      revoked,
      used
    }),
    consumeVerifiedChallenge: async ({ challengeId, profileAlias, code }) => {
      calls.push({ kind: 'consume', challengeId, profileAlias, code });
      if (revoked) return 'revoked';
      if (used) return 'replayed';
      if (code !== '123456') return 'invalid';
      used = true;
      return 'consumed';
    },
    issueOpaqueCredential: async ({ challengeId, profileAlias }) => {
      calls.push({ kind: 'issue', challengeId, profileAlias });
      return {
        credentialId: 'credential-001',
        profileAlias,
        expiresAt: NOW + 3_600_000
      };
    },
    revokeOpaqueCredential: async ({ profileAlias, credentialId }) => {
      calls.push({ kind: 'revoke', profileAlias, credentialId });
      if (credentialId !== 'credential-001') return false;
      revoked = true;
      return true;
    },
    ...overrides
  });
  return { contract, calls, setUsed: value => { used = value; }, setRevoked: value => { revoked = value; } };
}

(async () => {
  {
    const { contract } = fixture();
    const result = await contract.pair({ profileAlias: 'perfil-1', code: '123456' });
    assert.deepEqual(result, {
      ok: true,
      code: 'paired',
      credential: { id: 'credential-001', expiresAt: NOW + 3_600_000 }
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.credential), true);
  }

  {
    const { contract } = fixture();
    assert.deepEqual(
      await contract.pair({ profileAlias: 'perfil-1', code: '12x456' }),
      { ok: false, code: 'invalid' }
    );
  }

  {
    const { contract } = fixture({
      loadVerifiedChallenge: async ({ profileAlias }) => ({
        challengeId: 'challenge-001',
        profileAlias,
        expiresAt: NOW,
        revoked: false,
        used: false
      })
    });
    assert.deepEqual(
      await contract.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'expired' }
    );
  }

  {
    const { contract, setUsed } = fixture();
    setUsed(true);
    assert.deepEqual(
      await contract.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'replayed' }
    );
  }

  {
    const { contract, setRevoked } = fixture();
    setRevoked(true);
    assert.deepEqual(
      await contract.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'revoked' }
    );
  }

  {
    const { contract } = fixture({
      now: (() => {
        let calls = 0;
        return () => {
          calls += 1;
          if (calls === 1) throw new Error('clock unavailable');
          return NOW;
        };
      })()
    });
    assert.deepEqual(
      await contract.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'failed' }
    );
  }

  {
    const { contract } = fixture({
      consumeVerifiedChallenge: async () => 'expired'
    });
    assert.deepEqual(
      await contract.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'expired' }
    );
  }

  {
    const secret = 'super-secret-pairing-token';
    const { contract } = fixture({
      consumeVerifiedChallenge: async () => { throw new Error(secret); }
    });
    const result = await contract.pair({ profileAlias: 'perfil-1', code: '123456' });
    assert.deepEqual(result, { ok: false, code: 'failed' });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(result).includes('123456'), false);
  }

  {
    const { contract } = fixture();
    assert.deepEqual(
      await contract.revoke({ profileAlias: 'perfil-1', credentialId: 'credential-001' }),
      { ok: true, code: 'revoked' }
    );
    assert.deepEqual(
      await contract.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'revoked' }
    );
  }

  {
    const { contract } = fixture();
    assert.deepEqual(
      await contract.revoke({ profileAlias: 'perfil-1', credentialId: 'missing-credential' }),
      { ok: false, code: 'not_found' }
    );
  }

  {
    let clockCalls = 0;
    const { contract } = fixture({
      now: () => {
        clockCalls += 1;
        return clockCalls === 1 ? NOW : NOW + 30 * 60 * 60 * 1000;
      },
      issueOpaqueCredential: async ({ profileAlias }) => ({
        credentialId: 'credential-001',
        profileAlias,
        expiresAt: NOW + (23 * 60 * 60 * 1000)
      })
    });
    assert.deepEqual(
      await contract.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'failed' }
    );
  }


  {
    const { contract, calls } = fixture();
    const stored = [];
    const persisted = createPersistedPairingContract({
      pairing: contract,
      credentialStore: {
        save: async row => { stored.push(structuredClone(row)); },
        remove: async row => {
          const index = stored.findIndex(item =>
            item.profileAlias === row.profileAlias && item.id === row.id);
          if (index === -1) return false;
          stored.splice(index, 1);
          return true;
        }
      },
      auditStore: { append: async () => true }
    });
    assert.deepEqual(
      await persisted.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: true, code: 'paired', credential: { id: 'credential-001', expiresAt: NOW + 3_600_000 } }
    );
    assert.deepEqual(stored, [{
      profileAlias: 'perfil-1',
      id: 'credential-001',
      expiresAt: NOW + 3_600_000
    }]);
    assert.deepEqual(
      await persisted.revoke({ profileAlias: 'perfil-1', credentialId: 'credential-001' }),
      { ok: true, code: 'revoked' }
    );
    assert.deepEqual(stored, []);
    assert.equal(calls.filter(call => call.kind === 'revoke').length, 1);
  }

  {
    const { contract, calls } = fixture();
    const persisted = createPersistedPairingContract({
      pairing: contract,
      credentialStore: {
        save: async () => { throw new Error('private storage path'); },
        remove: async () => true
      },
      auditStore: { append: async () => true }
    });
    const result = await persisted.pair({ profileAlias: 'perfil-1', code: '123456' });
    assert.deepEqual(result, { ok: false, code: 'failed' });
    assert.equal(calls.filter(call => call.kind === 'revoke').length, 1);
    assert.equal(JSON.stringify(result).includes('private storage path'), false);
    assert.equal(JSON.stringify(result).includes('123456'), false);
  }

  {
    const { contract, calls } = fixture({
      revokeOpaqueCredential: async ({ profileAlias, credentialId }) => {
        calls.push({ kind: 'revoke', profileAlias, credentialId });
        return false;
      }
    });
    const stored = [{
      profileAlias: 'perfil-1',
      id: 'credential-001',
      expiresAt: NOW + 3_600_000
    }];
    const persisted = createPersistedPairingContract({
      pairing: contract,
      credentialStore: {
        save: async () => {},
        remove: async row => {
          const index = stored.findIndex(item =>
            item.profileAlias === row.profileAlias && item.id === row.id);
          if (index === -1) return false;
          stored.splice(index, 1);
          return true;
        }
      },
      auditStore: { append: async () => true }
    });
    assert.deepEqual(
      await persisted.revoke({ profileAlias: 'perfil-1', credentialId: 'credential-001' }),
      { ok: false, code: 'not_found' }
    );
    assert.deepEqual(stored, []);
  }

  {
    const { contract } = fixture({
      revokeOpaqueCredential: async () => { throw new Error('remote secret'); }
    });
    let removed = false;
    const persisted = createPersistedPairingContract({
      pairing: contract,
      credentialStore: {
        save: async () => {},
        remove: async () => { removed = true; return true; }
      },
      auditStore: { append: async () => true }
    });
    assert.deepEqual(
      await persisted.revoke({ profileAlias: 'perfil-1', credentialId: 'credential-001' }),
      { ok: false, code: 'failed' }
    );
    assert.equal(removed, false);
  }

  {
    const persisted = createPersistedPairingContract({
      pairing: {
        pair: async () => ({ ok: true, code: 'paired', credential: { id: 'bad', expiresAt: NOW + 1 } }),
        revoke: async () => ({ ok: false, code: 'failed' })
      },
      credentialStore: { save: async () => {}, remove: async () => true }
    });
    assert.deepEqual(
      await persisted.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'failed' }
    );
  }


  // AC-02: the injected fake journal outlives the persisted pairing instance,
  // while the opaque credential is removed from the separate local store.
  {
    const { contract, calls } = fixture();
    const journal = [];
    const stored = new Map();
    const credentialStore = {
      save: async row => { stored.set(row.profileAlias, structuredClone(row)); },
      remove: async row => stored.delete(row.profileAlias)
    };
    const auditStore = {
      append: async event => {
        journal.push(structuredClone(event));
        return true; // Fake durable-adapter acknowledgment.
      }
    };
    const persisted = createPersistedPairingContract({
      pairing: contract, credentialStore, auditStore
    });
    const paired = await persisted.pair({ profileAlias: 'perfil-1', code: '123456' });
    assert.equal(paired.code, 'paired');
    assert.equal(stored.size, 1);
    assert.deepEqual(
      await persisted.revoke({ profileAlias: 'perfil-1', credentialId: 'credential-001' }),
      { ok: true, code: 'revoked' }
    );
    assert.equal(stored.size, 0);
    assert.equal(calls.filter(call => call.kind === 'revoke').length, 1);
    const recreated = createPersistedPairingContract({
      pairing: contract, credentialStore, auditStore
    });
    assert.equal(typeof recreated.revoke, 'function');
    assert.deepEqual(journal, [
      { event: 'pairing_revocation', phase: 'attempt' },
      { event: 'pairing_revocation', phase: 'result', outcome: 'revoked' }
    ]);
    assert.equal(JSON.stringify(journal).includes('credential-001'), false);
    assert.equal(JSON.stringify(journal).includes('perfil-1'), false);
    assert.equal(JSON.stringify(journal).includes('123456'), false);
    console.log('pairing-audit AC-02: ok');
  }

  // AC-03: secrets, profile aliases and adapter errors never reach an
  // observable result or journal, even through failure paths.
  {
    const privateMessage = 'private-adapter-token';
    const { contract, calls } = fixture();
    const journal = [];
    const persisted = createPersistedPairingContract({
      pairing: contract,
      credentialStore: { save: async () => {}, remove: async () => true },
      auditStore: {
        append: async record => {
          journal.push(structuredClone(record));
          if (journal.length === 2) throw new Error(privateMessage);
          return true;
        }
      }
    });
    const result = await persisted.revoke({
      profileAlias: 'secret-profile', credentialId: 'credential-001'
    });
    assert.deepEqual(result, { ok: false, code: 'failed' });
    assert.equal(calls.filter(call => call.kind === 'revoke').length, 1);
    const visible = JSON.stringify({ result, journal });
    for (const secret of [privateMessage, 'secret-profile', 'credential-001', '123456']) {
      assert.equal(visible.includes(secret), false);
    }
    console.log('pairing-audit AC-03: ok');
  }

  // AC-04: never revoke without acknowledged pre-audit, and never claim a
  // successful revocation if the post-effect evidence cannot be committed.
  {
    const input = { profileAlias: 'perfil-1', credentialId: 'credential-001' };
    for (const invalidAck of [false, undefined, null]) {
      const { contract, calls } = fixture();
      let removed = false;
      const persisted = createPersistedPairingContract({
        pairing: contract,
        credentialStore: {
          save: async () => {},
          remove: async () => { removed = true; return true; }
        },
        auditStore: { append: async () => invalidAck }
      });
      assert.deepEqual(await persisted.revoke(input), { ok: false, code: 'failed' });
      assert.equal(calls.some(call => call.kind === 'revoke'), false);
      assert.equal(removed, false);
    }
    // A throwing write-ahead adapter is also a strict no-effect failure.
    {
      const { contract, calls } = fixture();
      const persisted = createPersistedPairingContract({
        pairing: contract,
        credentialStore: { save: async () => {}, remove: async () => true },
        auditStore: { append: async () => { throw new Error('private audit error'); } }
      });
      assert.deepEqual(await persisted.revoke(input), { ok: false, code: 'failed' });
      assert.equal(calls.some(call => call.kind === 'revoke'), false);
    }
    // Remote revocation may have occurred: no success without local removal.
    {
      const { contract, calls } = fixture();
      const recorded = [];
      const persisted = createPersistedPairingContract({
        pairing: contract,
        credentialStore: { save: async () => {}, remove: async () => false },
        auditStore: {
          append: async entry => { recorded.push(structuredClone(entry)); return true; }
        }
      });
      assert.deepEqual(await persisted.revoke(input), { ok: false, code: 'failed' });
      assert.equal(calls.filter(call => call.kind === 'revoke').length, 1);
      assert.deepEqual(recorded, [{ event: 'pairing_revocation', phase: 'attempt' }]);
    }
    const { contract, calls } = fixture();
    let records = 0;
    const persisted = createPersistedPairingContract({
      pairing: contract,
      credentialStore: { save: async () => {}, remove: async () => true },
      auditStore: { append: async () => (++records === 1) }
    });
    assert.deepEqual(await persisted.revoke(input), { ok: false, code: 'failed' });
    assert.equal(records, 2);
    assert.equal(calls.filter(call => call.kind === 'revoke').length, 1);
    const { contract: missingContract, calls: missingCalls } = fixture();
    const missingAudit = createPersistedPairingContract({
      pairing: missingContract,
      credentialStore: { save: async () => {}, remove: async () => true }
    });
    assert.deepEqual(await missingAudit.revoke(input), { ok: false, code: 'failed' });
    assert.equal(missingCalls.some(call => call.kind === 'revoke'), false);
    console.log('pairing-audit AC-04: ok');
  }

  console.log('pairing-audit AC-01: ok');

  console.log('factory-control pairing contract: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
