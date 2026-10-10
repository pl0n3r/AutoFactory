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
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const COMMAND_KEY_RE = /^(?:pause|resume):(?:instance|[0-9]+):[0-9]+:[0-9]+$/;

  // Only coordinates ledgers sharing the same save function in this JS realm.
  // A cross-context/production sender still requires a durable atomic claim.
  const V1_SHARED_QUEUES = new WeakMap();

  function createLedger({ load, save, maxEntries = 256 } = {}) {
    if (!protocol || typeof protocol.command !== 'function' ||
        typeof load !== 'function' || typeof save !== 'function' ||
        !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) {
      throw new TypeError('A protocol, storage adapter and bounded capacity are required');
    }
    // v1 serialization is shared across instances using this storage adapter.
    // Per-instance capability for an ambiguous post-effect audit result.
    const ambiguousResult = Object.freeze({});
    function deferOutcome() { return ambiguousResult; }

    function checked(receipts) {
      if (!Array.isArray(receipts) || receipts.length > maxEntries) {
        throw new TypeError('Invalid persisted command ledger');
      }
      const ids = new Set();
      // Array.prototype.map skips holes, so reject them before any pending receipt
      // is written or a command handler can run.
      for (let index = 0; index < receipts.length; index++) {
        if (!Object.hasOwn(receipts, index)) {
          throw new TypeError('Invalid persisted command ledger');
        }
      }
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

    async function persistAndVerify(expectedReceipts) {
      // A silent or false-ACK storage adapter must never authorize an effect.
      // Verify the exact receipt set after writes, even for legacy adapters
      // that return undefined after successfully persisting.
      const acknowledgement = await save(expectedReceipts);
      if (acknowledgement === false) {
        throw new Error('Command receipt persistence not confirmed');
      }
      const observed = checked(await load());
      if (observed.length !== expectedReceipts.length ||
          observed.some((row, index) =>
            row.id !== expectedReceipts[index].id ||
            row.state !== expectedReceipts[index].state ||
            row.code !== expectedReceipts[index].code)) {
        throw new Error('Command receipt persistence not confirmed');
      }
    }

    async function execute(input, handler) {
      const command = protocol.command(input);
      if (typeof handler !== 'function') throw new TypeError('Command handler required');
      const priorTask = V1_SHARED_QUEUES.get(save) || Promise.resolve();
      const task = priorTask.then(async () => {
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
        await persistAndVerify(pending); // confirmed before the effect
        let ack;
        try {
          const outcome = await handler(command);
          if (outcome === ambiguousResult) {
            // Retain the persisted pending receipt and block future replays.
            return protocol.acknowledgement({
              id: command.id, ok: false, code: 'not_ready'
            });
          }
          ack = protocol.acknowledgement({ id: command.id, ok: outcome?.ok, code: outcome?.code });
        } catch (_error) {
          ack = protocol.acknowledgement({ id: command.id, ok: false, code: 'failed' });
        }
        await persistAndVerify([...receipts, {
          id: command.id, state: 'done', code: ack.code
        }]);
        return ack;
      });
      V1_SHARED_QUEUES.set(save, task.then(() => undefined, () => undefined));
      return task;
    }
    return Object.freeze({ execute, deferOutcome });
  }

  function commandKey(command) {
    return [
      command.action,
      command.target,
      command.issuedAt,
      command.expiresAt
    ].join(':');
  }

  function createInstanceLedger({ instanceId, load, save, maxEntries = 256 } = {}) {
    let normalizedInstanceId;
    try {
      normalizedInstanceId = protocol?.validationV2?.instanceId(instanceId);
    } catch (_error) {
      normalizedInstanceId = null;
    }
    if (!protocol || typeof protocol.commandV2 !== 'function' ||
        typeof protocol.acknowledgementV2 !== 'function' ||
        !protocol.validationV2 ||
        normalizedInstanceId !== instanceId ||
        typeof load !== 'function' || typeof save !== 'function' ||
        !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) {
      throw new TypeError('A v2 instance, storage adapter and bounded capacity are required');
    }
    let queue = Promise.resolve();

    function checked(receipts) {
      if (!Array.isArray(receipts) || receipts.length > maxEntries) {
        throw new TypeError('Invalid persisted v2 command ledger');
      }
      const ids = new Set();
      const normalized = [];
      for (let index = 0; index < receipts.length; index++) {
        if (!Object.hasOwn(receipts, index)) {
          throw new TypeError('Invalid persisted v2 command ledger');
        }
        const receipt = receipts[index];
        const fields = [
          'id', 'instanceId', 'commandKey', 'state',
          'code', 'enabled', 'appliedTabs'
        ];
        let validatedAck;
        try {
          protocol.validationV2.exactObject(
            receipt, fields, 'persisted v2 command receipt'
          );
          validatedAck = protocol.acknowledgementV2({
            version: 2,
            kind: 'ack',
            id: receipt.id,
            instanceId: receipt.instanceId,
            ok: receipt.code === 'ok',
            code: receipt.code,
            enabled: receipt.enabled,
            appliedTabs: receipt.appliedTabs
          });
        } catch (_error) {
          throw new TypeError('Invalid persisted v2 command receipt');
        }
        const appliedTabs = validatedAck.appliedTabs;
        if (validatedAck.instanceId !== instanceId ||
            typeof receipt.commandKey !== 'string' ||
            !COMMAND_KEY_RE.test(receipt.commandKey) ||
            !['pending', 'done'].includes(receipt.state) ||
            (receipt.state === 'pending' &&
              (receipt.code !== 'not_ready' || receipt.enabled !== false || appliedTabs.length !== 0))) {
          throw new TypeError('Invalid persisted v2 command receipt');
        }
        if (ids.has(receipt.id)) {
          throw new TypeError('Invalid persisted v2 command receipt');
        }
        ids.add(receipt.id);
        normalized.push({
          id: receipt.id,
          instanceId: receipt.instanceId,
          commandKey: receipt.commandKey,
          state: receipt.state,
          code: receipt.code,
          enabled: receipt.enabled,
          appliedTabs
        });
      }
      return normalized;
    }

    function ackFromReceipt(receipt) {
      return protocol.acknowledgementV2({
        version: 2,
        kind: 'ack',
        id: receipt.id,
        instanceId: receipt.instanceId,
        ok: receipt.code === 'ok',
        code: receipt.code,
        enabled: receipt.enabled,
        appliedTabs: receipt.appliedTabs
      });
    }

    async function execute(input, handler) {
      const command = protocol.commandV2(input);
      if (command.instanceId !== instanceId) {
        throw new TypeError('Command instance does not match ledger');
      }
      if (typeof handler !== 'function') throw new TypeError('Command handler required');
      const key = commandKey(command);

      const task = queue.then(async () => {
        const receipts = checked(await load());
        const prior = receipts.find(receipt => receipt.id === command.id);
        if (prior) {
          if (prior.instanceId !== command.instanceId || prior.commandKey !== key) {
            throw new TypeError('Command ID is already bound to another v2 command');
          }
          return ackFromReceipt(prior);
        }

        if (receipts.length >= maxEntries) {
          throw new Error('Command ledger is full');
        }

        const pendingReceipt = {
          id: command.id,
          instanceId: command.instanceId,
          commandKey: key,
          state: 'pending',
          code: 'not_ready',
          enabled: false,
          appliedTabs: []
        };
        await save([...receipts, pendingReceipt]);

        let ack;
        try {
          const outcome = await handler(command);
          ack = protocol.acknowledgementV2({
            version: 2,
            kind: 'ack',
            id: command.id,
            instanceId: command.instanceId,
            ok: outcome?.ok,
            code: outcome?.code,
            enabled: outcome?.enabled,
            appliedTabs: outcome?.appliedTabs
          });
        } catch (_error) {
          ack = protocol.acknowledgementV2({
            version: 2,
            kind: 'ack',
            id: command.id,
            instanceId: command.instanceId,
            ok: false,
            code: 'failed',
            enabled: false,
            appliedTabs: []
          });
        }

        const doneReceipt = {
          id: command.id,
          instanceId: command.instanceId,
          commandKey: key,
          state: 'done',
          code: ack.code,
          enabled: ack.enabled,
          appliedTabs: ack.appliedTabs
        };
        await save([...receipts, doneReceipt]);
        return ack;
      });

      queue = task.then(() => undefined, () => undefined);
      return task;
    }

    return Object.freeze({ execute });
  }

  return Object.freeze({ createLedger, createInstanceLedger });
});
