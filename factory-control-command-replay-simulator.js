'use strict';

// Isolated, offline test harness. This module is NOT imported by the extension.
// The existing persistent ledger, not a simulated sender, owns idempotency.
const { createLedger } = require('./factory-control-ledger.js');

const FIXTURE_ID = /^fixture_[a-z][a-z0-9_-]{0,50}$/;
const RESULT_CODES = new Set([
  'ok', 'invalid', 'unauthorized', 'timeout', 'already_handled',
  'not_ready', 'failed'
]);

function response(code) {
  if (!RESULT_CODES.has(code)) throw new TypeError('Unrecognized fixture result');
  return Object.freeze({ ok: code === 'ok', code });
}

function createMemoryReceiptStorage() {
  let receipts = [];
  let failFinalWrite = false;
  return Object.freeze({
    async load() {
      return structuredClone(receipts);
    },
    async save(rows) {
      // Inject a post-effect crash: the durable pending receipt survives.
      if (failFinalWrite && Array.isArray(rows) && rows.some(row => row?.state === 'done')) {
        failFinalWrite = false;
        throw new Error('synthetic persistence interruption');
      }
      receipts = structuredClone(rows);
      return true;
    },
    failNextFinalWrite() {
      failFinalWrite = true;
    },
    snapshot() {
      return structuredClone(receipts);
    }
  });
}

function validFrame(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = ['id', 'identity', 'issuedAt', 'expiresAt', 'outcome', 'ack'];
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !expected.every(k => Object.hasOwn(value, k))) return false;
  return FIXTURE_ID.test(value.id) &&
    ['active', 'revoked'].includes(value.identity) &&
    Number.isSafeInteger(value.issuedAt) && value.issuedAt >= 0 &&
    Number.isSafeInteger(value.expiresAt) && value.expiresAt > value.issuedAt &&
    ['ok', 'late', 'failed'].includes(value.outcome) &&
    ['delivered', 'lost'].includes(value.ack);
}

function createReplaySimulator({ storage = createMemoryReceiptStorage(), now = () => 1000,
  effects = { count: 0 } } = {}) {
  if (!storage || typeof storage.load !== 'function' || typeof storage.save !== 'function' ||
      typeof now !== 'function' || !effects ||
      !Number.isSafeInteger(effects.count) || effects.count < 0) {
    throw new TypeError('Offline fixture adapters required');
  }
  const ledger = createLedger({ load: storage.load, save: storage.save });

  async function submit(frame) {
    // No actions, DOM, remote handles or payloads are accepted from callers.
    if (!validFrame(frame)) return response('invalid');
    if (frame.identity === 'revoked') return response('unauthorized');
    let current;
    try { current = now(); } catch (_error) { return response('not_ready'); }
    if (!Number.isSafeInteger(current) || current < 0) return response('not_ready');
    if (frame.issuedAt > current || frame.expiresAt <= current) return response('timeout');

    try {
      const result = await ledger.execute(
        // The only command is a synthetic local order, with no chat text.
        { id: frame.id, action: 'pause', target: 7 },
        async () => {
          effects.count += 1; // Only simulated effect, never a sender.
          if (frame.outcome === 'late') return ledger.deferOutcome();
          if (frame.outcome === 'failed') return { ok: false, code: 'failed' };
          return { ok: true, code: 'ok' };
        }
      );
      // Simulate lost ACK after a committed effect. Retries read the ledger.
      if (frame.ack === 'lost' && result.code === 'ok') return response('timeout');
      return response(result.code);
    } catch (_error) {
      // A storage crash may follow an effect: NEVER infer success or retry.
      return response('not_ready');
    }
  }

  return Object.freeze({ submit, effectCount: () => effects.count });
}

module.exports = Object.freeze({ createMemoryReceiptStorage, createReplaySimulator });
