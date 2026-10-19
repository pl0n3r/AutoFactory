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
    assert.deepEqual(result, { ok: true, code: 'paired' });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.hasOwn(result, 'credential'), false);
    assert.deepEqual(Object.keys(result), ['ok', 'code']);
    assert.equal(JSON.stringify(result).includes('credential-001'), false);
  }

  // Regression: a public result must not unlock a handle through a
  // caller-supplied fake pairing source and a hostile credential store.
  {
    const { contract } = fixture();
    const exposed = await contract.pair({ profileAlias: 'perfil-1', code: '123456' });
    let leaked = 0;
    const forged = createPersistedPairingContract({
      pairing: { pair: async () => exposed, revoke: async () => ({ ok:false, code:'failed' }) },
      credentialStore: {
        save: async () => { leaked++; return true; },
        remove: async () => true
      },
      auditStore: { append: async () => true }
    });
    assert.deepEqual(await forged.pair({ profileAlias:'perfil-1', code:'123456' }),
      { ok:false, code:'failed' });
    assert.equal(leaked, 0);
    assert.deepEqual(Object.keys(exposed), ['ok','code']);
    assert.equal(JSON.stringify(exposed).includes('credential-001'), false);
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
        save: async row => { stored.push(structuredClone(row)); return true; },
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
      { ok: true, code: 'paired' }
    );
    // Only the trusted store receives the revocable handle, never callers.
    assert.equal(JSON.stringify(await persisted.pair({ profileAlias: 'perfil-1', code: '12x456' })).includes('credential-001'), false);
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


  // A malicious fake provider must never execute accessors when its result
  // reaches the persisted pairing trust boundary.
  {
    let getterCalls = 0, storeCalls = 0;
    const forged = Object.defineProperties({}, {
      ok: { enumerable: true, value: true },
      code: { enumerable: true, get() {
        getterCalls++;
        throw new Error('private getter side effect');
      }}
    });
    const persisted = createPersistedPairingContract({
      pairing: {
        pair: async () => forged,
        revoke: async () => ({ ok: false, code: 'failed' })
      },
      credentialStore: {
        save: async () => { storeCalls++; return true; },
        remove: async () => true
      },
      auditStore: { append: async () => true }
    });
    assert.deepEqual(
      await persisted.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'failed' }
    );
    assert.equal(getterCalls, 0);
    assert.equal(storeCalls, 0);
  }

  // A malicious provider can supply two safe own data fields and still
  // attach an inherited toJSON capable of exfiltrating a private token.
  // Public API outputs must be new allowlisted objects, not adapter references.
  {
    let serializations = 0;
    const hostile = (ok, code) => Object.assign(
      Object.create({ toJSON() {
        serializations++;
        return { leaked: 'synthetic-private-credential' };
      }}),
      { ok, code }
    );
    const input = { profileAlias: 'perfil-1', code: '123456' };
    const persisted = createPersistedPairingContract({
      pairing: {
        pair: async () => hostile(false, 'invalid'),
        revoke: async () => hostile(true, 'revoked')
      },
      credentialStore: {
        save: async () => { throw new Error('must not store invalid pairing'); },
        remove: async () => true
      },
      auditStore: { append: async () => true }
    });
    const failure = await persisted.pair(input);
    const revoked = await persisted.revoke({
      profileAlias: 'perfil-1', credentialId: 'credential-001'
    });
    assert.deepEqual(failure, { ok: false, code: 'invalid' });
    assert.deepEqual(revoked, { ok: true, code: 'revoked' });
    assert.equal(Object.getPrototypeOf(failure), Object.prototype);
    assert.equal(Object.getPrototypeOf(revoked), Object.prototype);
    assert.equal(JSON.stringify({ failure, revoked }).includes('synthetic-private-credential'), false);
    assert.equal(serializations, 0);
  }

  // A resolved but unacknowledged save must never issue a 'paired' result.
  // Compensation is attempted under the pre-issuance audit evidence.
  {
    for (const saveAck of [false, undefined, null, 'true']) {
      const { contract, calls } = fixture();
      const journal = [];
      const persisted = createPersistedPairingContract({
        pairing: contract,
        credentialStore: {
          save: async () => saveAck,
          remove: async () => true
        },
        auditStore: {
          append: async record => { journal.push(structuredClone(record)); return true; }
        }
      });
      const outcome = await persisted.pair({ profileAlias: 'perfil-1', code: '123456' });
      assert.deepEqual(outcome, { ok: false, code: 'failed' });
      assert.equal(calls.filter(item => item.kind === 'issue').length, 1);
      assert.equal(calls.filter(item => item.kind === 'revoke').length, 1);
      assert.deepEqual(journal.map(item => item.phase), ['eligible', 'attempt', 'result']);
      assert.equal(new Set(journal.map(item => item.auditId)).size, 1);
      assert.equal(JSON.stringify(journal).includes('credential-001'), false);
    }
  }

  // AC-02: the injected fake journal outlives the persisted pairing instance,
  // while the opaque credential is removed from the separate local store.
  {
    const { contract, calls } = fixture();
    const journal = [];
    const stored = new Map();
    const credentialStore = {
      save: async row => { stored.set(row.profileAlias, structuredClone(row)); return true; },
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
    assert.equal(journal.length, 3);
    assert.equal(journal[0].event, 'pairing_compensation');
    assert.equal(journal[0].phase, 'eligible');
    assert.equal(journal[1].event, 'pairing_revocation');
    assert.equal(journal[1].phase, 'attempt');
    assert.equal(journal[2].phase, 'result');
    assert.equal(journal[2].outcome, 'revoked');
    assert.equal(journal[1].auditId, journal[2].auditId);
    assert.notEqual(journal[0].auditId, journal[1].auditId);
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
    await Promise.all([false, undefined, null].map(async invalidAck => {
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
    }));
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
      assert.equal(recorded.length, 1);
      assert.equal(recorded[0].event, 'pairing_revocation');
      assert.equal(recorded[0].phase, 'attempt');
      assert.match(recorded[0].auditId, /^[0-9a-f-]{36}$/i);
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

  // Compensation follows a safety-intent written before issuing a credential;
  // even if the subsequent audit adapter fails, an issued handle is revoked.
  {
    const { contract, calls } = fixture();
    const journal = [];
    const persisted = createPersistedPairingContract({
      pairing: contract,
      credentialStore: {
        save: async () => { throw new Error('sensitive-storage-error'); },
        remove: async () => true
      },
      auditStore: {
        append: async event => { journal.push(structuredClone(event)); return true; }
      }
    });
    assert.deepEqual(
      await persisted.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'failed' }
    );
    assert.equal(calls.filter(item => item.kind === 'revoke').length, 1);
    assert.deepEqual(journal.map(item => item.phase), ['eligible', 'attempt', 'result']);
    assert.deepEqual(journal.map(item => item.event),
      ['pairing_compensation', 'pairing_compensation', 'pairing_compensation']);
    assert.equal(new Set(journal.map(item => item.auditId)).size, 1);
    assert.equal(journal[2].outcome, 'revoked');
    const output = JSON.stringify(journal);
    for (const secret of ['perfil-1', '123456', 'credential-001', 'sensitive-storage-error']) {
      assert.equal(output.includes(secret), false);
    }
  }
  {
    const { contract, calls } = fixture();
    const persisted = createPersistedPairingContract({
      pairing: contract,
      credentialStore: {
        save: async () => { throw new Error('store failed'); },
        remove: async () => true
      },
      auditStore: {
        append: (() => {
          let count = 0;
          return async () => (++count !== 2);
        })()
      }
    });
    assert.deepEqual(
      await persisted.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'failed' }
    );
    assert.equal(calls.filter(item => item.kind === 'revoke').length, 1);
  }
  {
    const { contract, calls } = fixture();
    const persisted = createPersistedPairingContract({
      pairing: contract,
      credentialStore: { save: async () => {}, remove: async () => true },
      auditStore: { append: async () => false }
    });
    assert.deepEqual(
      await persisted.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: false, code: 'failed' }
    );
    assert.equal(calls.filter(item => ['consume', 'issue', 'revoke'].includes(item.kind)).length, 0);
  }

  // Concurrent revocations have independent non-sensitive correlation IDs.
  {
    const journal = [];
    const persisted = createPersistedPairingContract({
      pairing: {
        pair: async () => ({ ok: false, code: 'invalid' }),
        revoke: async () => ({ ok: true, code: 'revoked' })
      },
      credentialStore: {
        save: async () => {},
        remove: async () => true
      },
      auditStore: {
        append: async record => { journal.push(structuredClone(record)); return true; }
      }
    });
    const inputs = [
      { profileAlias: 'perfil-1', credentialId: 'credential-001' },
      { profileAlias: 'perfil-2', credentialId: 'credential-002' }
    ];
    const results = await Promise.all(inputs.map(input => persisted.revoke(input)));
    assert.deepEqual(results, [
      { ok: true, code: 'revoked' }, { ok: true, code: 'revoked' }
    ]);
    assert.equal(journal.length, 4);
    const ids = [...new Set(journal.map(item => item.auditId))];
    assert.equal(ids.length, 2);
    for (const id of ids) {
      const events = journal.filter(item => item.auditId === id);
      assert.equal(events.length, 2);
      assert.deepEqual(events.map(item => item.phase), ['attempt', 'result']);
      assert.equal(events[1].outcome, 'revoked');
    }
    assert.equal(journal.some(item => 'credentialId' in item || 'profileAlias' in item), false);
  }


  // Issue #154: emission is an effect even if later local validation fails.
  // All scenarios use synthetic handles; no browser, network or accounts.
  async function postIssueScenario(mode, usePersisted = true) {
    let issued = 0, revoked = 0, saved = 0, reads = 0, getters = 0, active = false;
    const journal = [];
    const pairing = createPairingContract({
      now: () => {
        reads++;
        return mode === 'clock' && reads === 2 ? NaN : NOW;
      },
      loadVerifiedChallenge: async ({ profileAlias }) => ({
        challengeId: 'challenge-001', profileAlias, expiresAt: NOW + 60_000,
        revoked: false, used: false
      }),
      consumeVerifiedChallenge: async () => 'consumed',
      issueOpaqueCredential: async ({ profileAlias }) => {
        issued++;
        active = true;
        if (mode === 'throw') throw new Error('private adapter error');
        if (mode === 'getter') {
          const value = { profileAlias, expiresAt: NOW + 3_600_000 };
          Object.defineProperty(value, 'credentialId', {
            enumerable: true,
            get() { getters++; throw new Error('private getter must not execute'); }
          });
          return value;
        }
        const value = {
          credentialId: mode === 'invalid_id' ? 'not valid' : 'credential-001',
          profileAlias: mode === 'wrong_alias' ? 'other-profile' : profileAlias,
          expiresAt: NOW + (['expiry', 'revoke_false'].includes(mode) ? 25 : 1) * 3_600_000
        };
        return value;
      },
      revokeOpaqueCredential: async ({ profileAlias, credentialId }) => {
        revoked++;
        assert.equal(profileAlias, 'perfil-1');
        assert.equal(credentialId, 'credential-001');
        if (mode === 'revoke_false') return false;
        active = false;
        return true;
      }
    });
    const contract = usePersisted ? createPersistedPairingContract({
      pairing,
      credentialStore: {
        save: async () => { saved++; return true; },
        remove: async () => true
      },
      auditStore: {
        append: async record => {
          journal.push(structuredClone(record));
          return true;
        }
      }
    }) : pairing;
    const result = await contract.pair({ profileAlias: 'perfil-1', code: '123456' });
    return { result, issued, revoked, saved, getters, active, journal };
  }

  // AC-01: verifiable remote handle issued before an invalid >24h expiry
  // must be compensated; no success leaks back to the caller.
  {
    const x = await postIssueScenario('expiry');
    assert.deepEqual(x.result, { ok: false, code: 'failed' });
    assert.deepEqual([x.issued, x.revoked, x.saved, x.active], [1, 1, 0, false]);
    assert.equal(JSON.stringify(x.result).includes('credential-001'), false);
    const direct = await postIssueScenario('expiry', false);
    assert.deepEqual([direct.revoked, direct.active], [1, false]);
  }

  // AC-02: post-issue clock failure also compensates. Unknown/unreadable
  // issuance cannot be called revoked, and never triggers a guessed request.
  {
    const x = await postIssueScenario('clock');
    assert.deepEqual(x.result, { ok: false, code: 'failed' });
    assert.deepEqual([x.issued, x.revoked, x.saved, x.active], [1, 1, 0, false]);
    const unknownResults = await Promise.all(
      ['wrong_alias', 'invalid_id', 'throw', 'getter'].map(mode => postIssueScenario(mode))
    );
    for (const denied of unknownResults) {
      assert.deepEqual(denied.result, { ok: false, code: 'failed' });
      assert.equal(denied.revoked, 0);
      assert.equal(denied.saved, 0);
      assert.equal(denied.getters, 0, 'untrusted issuer getters must not execute');
      assert.deepEqual(denied.journal.map(item => item.phase),
        ['eligible', 'attempt', 'result']);
      assert.equal(denied.journal.at(-1).outcome, 'unknown');
    }
  }

  // AC-03: correlate exactly one eligible/attempt/result per issued candidate.
  // A remote false result is not a confirmed revocation.
  {
    const x = await postIssueScenario('expiry');
    assert.deepEqual(x.journal.map(item => item.phase), ['eligible', 'attempt', 'result']);
    assert.equal(x.journal.at(-1).outcome, 'revoked');
    assert.equal(new Set(x.journal.map(item => item.auditId)).size, 1);
    assert.equal(x.journal.every(item => item.event === 'pairing_compensation'), true);
    assert.equal(x.journal.every(item =>
      Object.keys(item).every(key => ['event', 'phase', 'auditId', 'outcome'].includes(key))), true);
    assert.equal(/credential-001|perfil-1|123456|private adapter/.test(JSON.stringify(x.journal)), false);
    const noConfirmation = await postIssueScenario('revoke_false');
    assert.deepEqual(noConfirmation.result, { ok: false, code: 'failed' });
    assert.deepEqual([noConfirmation.revoked, noConfirmation.active, noConfirmation.saved],
      [1, true, 0]);
    assert.equal(noConfirmation.journal.at(-1).outcome, 'not_found');
    assert.equal(JSON.stringify(noConfirmation.journal).includes('credential-001'), false);
  }

  // AF129 AC-01: every challenge field must be own enumerable data.
  // A hostile getter cannot run, consume a code, or issue a credential.
  {
    const sample = () => ({
      challengeId: 'challenge-001', profileAlias: 'perfil-1',
      expiresAt: NOW + 60_000, revoked: false, used: false
    });
    for (const field of Object.keys(sample())) {
      const challenge = sample();
      let getterCalls = 0, consumed = 0, issued = 0;
      Object.defineProperty(challenge, field, {
        enumerable: true,
        get() { getterCalls++; throw new Error('synthetic secret getter'); }
      });
      const { contract } = fixture({
        loadVerifiedChallenge: async () => challenge,
        consumeVerifiedChallenge: async () => { consumed++; return 'consumed'; },
        issueOpaqueCredential: async () => { issued++; return {}; }
      });
      const result = await contract.pair({ profileAlias: 'perfil-1', code: '123456' });
      assert.deepEqual(result, { ok: false, code: 'failed' }, field);
      assert.equal(getterCalls, 0, field);
      assert.equal(consumed, 0, field);
      assert.equal(issued, 0, field);
      assert.equal(JSON.stringify(result).includes('secret'), false);
    }
  }

  // AF129 AC-02: the adapter may mutate its original challenge during await.
  // Consumption and credential issuance must use the same validated snapshot.
  {
    const challenge = {
      challengeId: 'challenge-001', profileAlias: 'perfil-1',
      expiresAt: NOW + 60_000, revoked: false, used: false
    };
    const ids = [];
    const { contract } = fixture({
      loadVerifiedChallenge: async () => challenge,
      consumeVerifiedChallenge: async ({ challengeId }) => {
        ids.push(challengeId);
        challenge.challengeId = 'challenge-999';
        challenge.profileAlias = 'otro';
        challenge.used = true;
        return 'consumed';
      },
      issueOpaqueCredential: async ({ challengeId, profileAlias }) => {
        ids.push(challengeId);
        assert.equal(profileAlias, 'perfil-1');
        return { credentialId: 'credential-001', profileAlias,
          expiresAt: NOW + 3_600_000 };
      }
    });
    assert.deepEqual(
      await contract.pair({ profileAlias: 'perfil-1', code: '123456' }),
      { ok: true, code: 'paired' }
    );
    assert.deepEqual(ids, ['challenge-001', 'challenge-001']);
  }
  console.log('AF129 challenge-snapshot AC-01..03: ok');

  // AC-04: legacy pairing, replay/persistence and explicit revoke assertions
  // above continue to execute in the same Node/CI suite unchanged.
  console.log('pairing-postissue AC-01..04: ok');

  console.log('pairing-audit AC-01: ok');

  // The existing npm test invokes this Node test. Execute all four Python
  // acceptance wrappers through that route without changing shared package.json.
  // The child guard prevents recursively launching the same Python suite.
  if (process.env.FACTORY_PAIRING_PYTHON_CHILD !== '1') {
    const { spawnSync } = require('node:child_process');
    const run = spawnSync('python3', [
      '-m', 'unittest', 'discover',
      '-s', 'tests', '-p', 'test_factory_control_pairing_*.py'
    ], {
      cwd: __dirname,
      // Never forward caller-controlled PATH, secrets or executable overrides.
      // Ubuntu runner's system Node/Python binaries are under fixed root-owned
      // directories; the nested acceptance tests need only this loop guard.
      env: { PATH: require('node:path').dirname(process.execPath) + ':/usr/local/bin:/usr/bin:/bin', FACTORY_PAIRING_PYTHON_CHILD: '1' },
      encoding: 'utf8',
      timeout: 30000
    });
    assert.equal(run.status, 0, 'pairing Python acceptance failed');
    console.log('pairing-audit Python AC-01..04: ok');
  }

  console.log('pairing-public AC-01..04: ok');
  console.log('factory-control pairing contract: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
