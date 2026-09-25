(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./factory-control-protocol.js')
      : root.ChatGPTAutopilotFactoryProtocol
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (protocol) {
  'use strict';

  const CODES = new Set([
    'ok', 'invalid', 'not_found', 'not_ready', 'timeout', 'unauthorized',
    'already_handled', 'failed'
  ]);
  function createLedger({ load, save, maxEntries = 256 } = {}) {
    if (!protocol || typeof protocol.command !== 'function' ||
        typeof load !== 'function' || typeof save !== 'function' ||
        !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) {
      throw new TypeError('A protocol, storage adapter and bounded capacity are required');
    }
    let queue = Promise.resolve();

    function checked(receipts) {
      if (!Array.isArray(receipts) || receipts.length > maxEntries) {
        throw new TypeError('Invalid persisted command ledger');
      }
      const ids = new Set();
      return receipts.map(receipt => {
        if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
            Object.keys(receipt).some(key => !['id', 'state', 'code'].includes(key)) ||
            !['pending', 'done'].includes(receipt.state)) {
          throw new TypeError('Invalid persisted command receipt');
        }
        const id = protocol.command({ id: receipt.id, action: 'pause', target: 'all' }).id;
        if (ids.has(id) || (receipt.state === 'pending' && receipt.code !== null) ||
            (receipt.state === 'done' && !CODES.has(receipt.code))) {
          throw new TypeError('Invalid persisted command receipt');
        }
        ids.add(id);
        return { id, state: receipt.state, code: receipt.code };
      });
    }

    async function execute(input, handler) {
      const command = protocol.command(input);
      if (typeof handler !== 'function') throw new TypeError('Command handler required');
      const task = queue.then(async () => {
        const receipts = checked(await load());
        const prior = receipts.find(receipt => receipt.id === command.id);
        if (prior) {
          return protocol.acknowledgement({
            id: command.id, ok: false,
            code: prior.state === 'pending' ? 'not_ready' : 'already_handled'
          });
        }
        // Never evict receipts silently: an evicted ID could execute a message twice.
        if (receipts.length >= maxEntries) throw new Error('Command ledger is full');
        const pending = [...receipts, { id: command.id, state: 'pending', code: null }];
        await save(pending); // fail closed before the external side effect
        let ack;
        try {
          const outcome = await handler(command);
          ack = protocol.acknowledgement({ id: command.id, ok: outcome?.ok, code: outcome?.code });
        } catch (_error) {
          ack = protocol.acknowledgement({ id: command.id, ok: false, code: 'failed' });
        }
        await save([...receipts, { id: command.id, state: 'done', code: ack.code }]);
        return ack;
      });
      queue = task.then(() => undefined, () => undefined);
      return task;
    }
    return Object.freeze({ execute });
  }
  return Object.freeze({ createLedger });
});
