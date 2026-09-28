(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryChromeStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY = 'factoryControlCommandReceiptsV1';
  const CREDENTIAL_KEY = 'factoryControlProfileCredentialsV1';
  const MAX_CREDENTIALS = 64;
  const MAX_CREDENTIAL_FUTURE_MS = 24 * 60 * 60 * 1000;
  const CODES = new Set([
    'ok', 'invalid', 'not_found', 'not_ready', 'timeout', 'unauthorized',
    'already_handled', 'failed'
  ]);
  const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
  const ALIAS = /^[A-Za-z0-9._-]+$/;

  function receiptsOnly(value) {
    if (!Array.isArray(value) || value.length > 4096) {
      throw new TypeError('Invalid command receipt collection');
    }
    const ids = new Set();
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError('Invalid command receipt collection');
      }
    }
    return value.map(receipt => {
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
          Object.keys(receipt).length !== 3 ||
          !['id', 'state', 'code'].every(key => Object.hasOwn(receipt, key)) ||
          typeof receipt.id !== 'string' || !ID.test(receipt.id) ||
          ids.has(receipt.id) ||
          !(receipt.state === 'pending' && receipt.code === null ||
            receipt.state === 'done' && CODES.has(receipt.code))) {
        throw new TypeError('Invalid command receipt');
      }
      ids.add(receipt.id);
      return { id: receipt.id, state: receipt.state, code: receipt.code };
    });
  }

  function profileAlias(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 64 ||
        value.includes('@') || !ALIAS.test(value)) {
      throw new TypeError('Invalid profile alias');
    }
    return value;
  }

  function credentialId(value) {
    if (typeof value !== 'string' || !ID.test(value) || value.length < 8) {
      throw new TypeError('Invalid opaque credential');
    }
    return value;
  }

  function credentialShape(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== 3 ||
        !['profileAlias', 'id', 'expiresAt'].every(key => Object.hasOwn(value, key)) ||
        !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 1) {
      throw new TypeError('Invalid opaque credential');
    }
    return {
      profileAlias: profileAlias(value.profileAlias),
      id: credentialId(value.id),
      expiresAt: value.expiresAt
    };
  }

  function credentialsOnly(value) {
    if (!Array.isArray(value) || value.length > MAX_CREDENTIALS) {
      throw new TypeError('Invalid profile credential collection');
    }
    const profiles = new Set();
    const ids = new Set();
    const out = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError('Invalid profile credential collection');
      }
      const row = credentialShape(value[index]);
      if (profiles.has(row.profileAlias) || ids.has(row.id)) {
        throw new TypeError('Invalid profile credential collection');
      }
      profiles.add(row.profileAlias);
      ids.add(row.id);
      out.push(row);
    }
    out.sort((a, b) => a.profileAlias.localeCompare(b.profileAlias));
    return out;
  }

  function currentTime(now) {
    let value;
    try { value = now(); } catch (_error) {
      // Clock adapter details may disclose host/runtime internals; expose a stable failure only.
      throw new Error('Profile credential clock unavailable');
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Profile credential clock unavailable');
    }
    return value;
  }

  function createRequest(local, runtime, message) {
    return function request(operation, arg) {
      return new Promise((resolve, reject) => {
        let finished = false;
        try {
          local[operation](arg, value => {
            if (finished) return;
            finished = true;
            // Never copy chrome.runtime.lastError.message: it may reveal paths or credentials.
            if (runtime.lastError) reject(new Error(message));
            else resolve(value);
          });
        } catch (_error) {
          // Storage adapter exceptions are intentionally collapsed to the caller-safe message.
          if (!finished) reject(new Error(message));
        }
      });
    };
  }

  function checkedStorage({ local, runtime } = {}) {
    if (!local || typeof local.get !== 'function' ||
        typeof local.set !== 'function' || !runtime || typeof runtime !== 'object') {
      throw new TypeError('chrome.storage.local and chrome.runtime are required');
    }
    return { local, runtime };
  }

  function createChromeReceiptStore(deps = {}) {
    const { local, runtime } = checkedStorage(deps);
    const request = createRequest(local, runtime, 'Command receipt storage unavailable');
    return Object.freeze({
      async load() {
        const values = await request('get', { [KEY]: [] });
        if (!values || typeof values !== 'object' || !Object.hasOwn(values, KEY)) {
          throw new TypeError('Invalid command receipt storage response');
        }
        return receiptsOnly(values[KEY]);
      },
      async save(receipts) {
        await request('set', { [KEY]: receiptsOnly(receipts) });
      }
    });
  }

  function createChromeProfileCredentialStore({ local, runtime, now = Date.now } = {}) {
    checkedStorage({ local, runtime });
    if (typeof now !== 'function') throw new TypeError('Credential clock is required');
    const request = createRequest(local, runtime, 'Profile credential storage unavailable');

    async function readAll() {
      const values = await request('get', { [CREDENTIAL_KEY]: [] });
      if (!values || typeof values !== 'object' || !Object.hasOwn(values, CREDENTIAL_KEY)) {
        throw new TypeError('Invalid profile credential storage response');
      }
      return credentialsOnly(values[CREDENTIAL_KEY]);
    }

    return Object.freeze({
      async load(alias) {
        const wanted = profileAlias(alias);
        const rows = await readAll();
        const found = rows.find(row => row.profileAlias === wanted);
        if (!found || found.expiresAt <= currentTime(now)) return null;
        return Object.freeze({ id: found.id, expiresAt: found.expiresAt });
      },

      async save(input) {
        const row = credentialShape(input);
        const nowMs = currentTime(now);
        if (row.expiresAt <= nowMs ||
            row.expiresAt > nowMs + MAX_CREDENTIAL_FUTURE_MS) {
          throw new TypeError('Invalid opaque credential');
        }
        const rows = await readAll();
        const index = rows.findIndex(item => item.profileAlias === row.profileAlias);
        if (index === -1 && rows.length >= MAX_CREDENTIALS) {
          throw new TypeError('Profile credential storage full');
        }
        const duplicate = rows.find(item =>
          item.id === row.id && item.profileAlias !== row.profileAlias);
        if (duplicate) throw new TypeError('Invalid opaque credential');
        if (index === -1) rows.push(row);
        else rows[index] = row;
        rows.sort((a, b) => a.profileAlias.localeCompare(b.profileAlias));
        await request('set', { [CREDENTIAL_KEY]: rows });
      },

      async remove(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
            Object.keys(input).length !== 2 ||
            !Object.hasOwn(input, 'profileAlias') || !Object.hasOwn(input, 'id')) {
          throw new TypeError('Invalid credential removal request');
        }
        const wantedProfile = profileAlias(input.profileAlias);
        const wantedId = credentialId(input.id);
        const rows = await readAll();
        const index = rows.findIndex(row =>
          row.profileAlias === wantedProfile && row.id === wantedId);
        if (index === -1) return false;
        rows.splice(index, 1);
        await request('set', { [CREDENTIAL_KEY]: rows });
        return true;
      }
    });
  }

  return Object.freeze({
    KEY,
    CREDENTIAL_KEY,
    createChromeReceiptStore,
    createChromeProfileCredentialStore
  });
});
