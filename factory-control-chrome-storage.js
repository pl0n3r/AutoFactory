(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryChromeStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY = 'factoryControlCommandReceiptsV1';
  const CODES = new Set([
    'ok', 'invalid', 'not_found', 'not_ready', 'timeout', 'unauthorized',
    'already_handled', 'failed'
  ]);
  const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

  function receiptsOnly(value) {
    if (!Array.isArray(value) || value.length > 4096) {
      throw new TypeError('Invalid command receipt collection');
    }
    const ids = new Set();
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

  function createChromeReceiptStore({ local, runtime } = {}) {
    if (!local || typeof local.get !== 'function' ||
        typeof local.set !== 'function' || !runtime || typeof runtime !== 'object') {
      throw new TypeError('chrome.storage.local and chrome.runtime are required');
    }
    function request(operation, arg) {
      return new Promise((resolve, reject) => {
        let finished = false;
        try {
          local[operation](arg, value => {
            if (finished) return;
            finished = true;
            // Do not copy chrome.runtime.lastError.message: it may reveal a path or token.
            if (runtime.lastError) reject(new Error('Command receipt storage unavailable'));
            else resolve(value);
          });
        } catch (_error) {
          if (!finished) reject(new Error('Command receipt storage unavailable'));
        }
      });
    }
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
  return Object.freeze({ KEY, createChromeReceiptStore });
});
