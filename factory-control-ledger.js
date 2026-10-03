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
  const INSTANCE_CODES = new Set([
    'ok', 'invalid', 'not_ready', 'timeout', 'unauthorized',
    'already_handled', 'failed'
  ]);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const COMMAND_KEY_RE = /^(?:pause|resume):(?:instance|[0-9]+):[0-9]+:[0-9]+$/;

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

  function exactDataObject(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== fields.length ||
        ownKeys.some(key => typeof key !== 'string' || !fields.includes(key))) return false;
    return fields.every(field => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return Object.hasOwn(value, field) && descriptor && descriptor.enumerable &&
        typeof descriptor.get !== 'function' && typeof descriptor.set !== 'function';
    });
  }

  function validIdentifier(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
  }

  function validInstanceId(value) {
    return typeof value === 'string' && UUID_RE.test(value);
  }

  function checkedTabs(values) {
    if (!Array.isArray(values) || values.length > 40) {
      throw new TypeError('Invalid persisted v2 applied tabs');
    }
    const seen = new Set();
    const result = [];
    for (let index = 0; index < values.length; index++) {
      if (!Object.hasOwn(values, index) ||
          !Number.isSafeInteger(values[index]) || values[index] < 0 ||
          seen.has(values[index])) {
        throw new TypeError('Invalid persisted v2 applied tabs');
      }
      seen.add(values[index]);
      result.push(values[index]);
    }
    return result;
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
    if (!protocol || typeof protocol.commandV2 !== 'function' ||
        typeof protocol.acknowledgementV2 !== 'function' ||
        !validInstanceId(instanceId) ||
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
        if (!exactDataObject(receipt, fields) ||
            !validIdentifier(receipt.id) ||
            !validInstanceId(receipt.instanceId) ||
            receipt.instanceId !== instanceId ||
            typeof receipt.commandKey !== 'string' ||
            !COMMAND_KEY_RE.test(receipt.commandKey) ||
            !['pending', 'done'].includes(receipt.state) ||
            !INSTANCE_CODES.has(receipt.code) ||
            typeof receipt.enabled !== 'boolean') {
          throw new TypeError('Invalid persisted v2 command receipt');
        }
        const appliedTabs = checkedTabs(receipt.appliedTabs);
        if (receipt.state === 'pending' &&
            (receipt.code !== 'not_ready' || receipt.enabled !== false || appliedTabs.length !== 0)) {
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
