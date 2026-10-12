/* AutoFactory #167. Offline local-network command contract; no network on import. */
(function (root, build) {
  'use strict';
  const api = build();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotLocalCommands = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const isObject = x => x !== null && typeof x === 'object' &&
    !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype ||
    Object.getPrototypeOf(x) === null);

  // IP literals only. Never permit DNS, credentials, IPv6, URL paths, query or
  // fragments; the configured endpoint is built from the checked origin.
  function privateOrigin(input) {
    if (typeof input !== 'string' || input.length > 80 ||
        !/^http:\/\/(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(input)) {
      throw new TypeError('private IPv4 origin required');
    }
    const match = /^http:\/\/([^:]+):(\d+)$/.exec(input);
    const octets = match[1].split('.').map(Number);
    const port = Number(match[2]);
    if (!octets.every((n, i) => Number.isInteger(n) && n <= 255 &&
        String(n) === match[1].split('.')[i]) ||
        !Number.isSafeInteger(port) || port < 1 || port > 65535) {
      throw new TypeError('invalid private origin');
    }
    const [a, b] = octets;
    if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) || (a === 127 && b === 0 &&
          octets[2] === 0 && octets[3] === 1))) {
      throw new TypeError('non-private destination forbidden');
    }
    return input;
  }

  // Validate data descriptors before reading any command values. Explicitly
  // ignore per-chat commands, which belong to a different authorized task.
  function globalCommand(raw) {
    if (!isObject(raw)) return null;
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== 3 || keys.some(k => typeof k !== 'string' ||
        !['id', 'chat_id', 'want'].includes(k))) return null;
    const values = Object.create(null);
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(raw, key);
      if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) return null;
      values[key] = d.value;
    }
    if (!Number.isSafeInteger(values.id) || values.id < 1 ||
        values.chat_id !== null ||
        (values.want !== 'stop' && values.want !== 'start')) return null;
    return Object.freeze({ id: values.id, want: values.want });
  }

  // Pure, injected coordinator: the caller supplies permission, durable
  // idempotency and a safe start gate. No fetch, alarm or storage side effect
  // is created here. Ambiguous outcomes must NOT be acknowledged.
  function createCommandProcessor({ enabled, allowedToStart, apply, seen, mark, ack } = {}) {
    if (![enabled, allowedToStart, apply, seen, mark, ack]
      .every(fn => typeof fn === 'function')) {
      throw new TypeError('command ports required');
    }
    let running = false;
    async function process(raw) {
      if (running) return false;
      running = true;
      try {
        if (await enabled() !== true) return false;
        const command = globalCommand(raw);
        if (!command) return false;
        if (await seen(command.id)) return false;
        if (command.want === 'start' && await allowedToStart() !== true) return false;
        // Recheck opt-in immediately before applying an instruction.
        // Durable at-most-once: persist a pending receipt BEFORE side effects.
        // If execution/ACK is ambiguous, the ID stays claimed for operator
        // reconciliation. Never replay an unacknowledged global command.
        if (await enabled() !== true) return false;
        if (await mark(command.id) !== true) return false;
        if (await enabled() !== true) return false;
        // Account/session state can change while the receipt is persisted.
        // Do not resume on a stale pre-mark authorization.
        if (command.want === 'start' && await allowedToStart() !== true) return false;
        if (await apply(command.want) !== true) return false;
        if (await enabled() !== true) return false;
        return await ack(command.id) === true;
      } catch (_error) {
        // Fail closed, no logs with secrets or chat data.
        return false;
      } finally {
        running = false;
      }
    }
    return Object.freeze({ process });
  }

  // A pure scheduler: the browser transport, storage, alarms and permissions
  // are injected by the future local-only adapter. Merely importing this
  // module NEVER starts a poll, opens a connection or reads a credential.
  function localPollingSettings(raw) {
    if (!isObject(raw)) return null;
    const expected = ['host', 'agentKey', 'instanceId'];
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== expected.length ||
        keys.some(k => typeof k !== 'string' || !expected.includes(k))) return null;
    const value = Object.create(null);
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor || !descriptor.enumerable ||
          !Object.hasOwn(descriptor, 'value')) return null;
      value[key] = descriptor.value;
    }
    try { privateOrigin(value.host); } catch (_error) { return null; }
    if (typeof value.agentKey !== 'string' ||
        value.agentKey.length < 12 || value.agentKey.length > 256 ||
        !/^[\x21-\x7e]+$/.test(value.agentKey) ||
        typeof value.instanceId !== 'string' ||
        !/^[A-Za-z0-9_.:-]{3,64}$/.test(value.instanceId)) return null;
    return Object.freeze(value);
  }

  function commandEnvelope(raw) {
    if (!isObject(raw)) return null;
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== 1 || keys[0] !== 'commands') return null;
    const descriptor = Object.getOwnPropertyDescriptor(raw, 'commands');
    if (!descriptor || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')) return null;
    const commands = descriptor.value;
    if (!Array.isArray(commands) || commands.length > 32 ||
        Reflect.ownKeys(commands).length !== commands.length + 1) return null;
    const values = [];
    for (let i = 0; i < commands.length; i++) {
      const item = Object.getOwnPropertyDescriptor(commands, String(i));
      if (!item || !Object.hasOwn(item, 'value') ||
          !item.enumerable) return null;
      values.push(item.value);
    }
    return values;
  }

  function createCommandPoller({ enabled, permission, configuration,
    fetchPending, process, now } = {}) {
    if (![enabled, permission, configuration, fetchPending, process, now]
      .every(fn => typeof fn === 'function')) {
      throw new TypeError('local command poller ports required');
    }
    const INTERVAL_MS = 8000;
    let running = false, stopped = false, failures = 0, nextAllowed = 0;
    async function tick() {
      if (stopped) return 'stopped';
      if (running) return 'busy';
      running = true;
      let started = 0;
      try {
        started = now();
        if (!Number.isSafeInteger(started) || started < 0) return 'unavailable';
        if (started < nextAllowed) return 'throttled';
        if (await enabled() !== true) return 'disabled';
        const local = localPollingSettings(await configuration());
        if (!local || await permission(local.host) !== true) return 'disabled';
        // Establish the minimum interval before any async network attempt.
        nextAllowed = started + INTERVAL_MS;
        const response = await fetchPending({
          origin:local.host, instanceId:local.instanceId, agentKey:local.agentKey
        });
        const commands = commandEnvelope(response);
        if (!commands) throw new TypeError('invalid local commands envelope');
        const result = await commands.reduce(async (prior, raw) => {
          const state = await prior;
          if (state.revoked) return state;
          const command = globalCommand(raw);
          if (!command) return state; // Per-chat commands MUST NOT be acked.
          const fresh = localPollingSettings(await configuration());
          if (stopped || await enabled() !== true || !fresh ||
              fresh.host !== local.host || fresh.agentKey !== local.agentKey ||
              fresh.instanceId !== local.instanceId ||
              await permission(local.host) !== true) {
            return { revoked:true, processed:state.processed };
          }
          const applied = await process(command);
          return { revoked:false, processed:state.processed + (applied === true ? 1 : 0) };
        }, Promise.resolve({revoked:false,processed:0}));
        if (result.revoked) return 'revoked';
        failures = 0;
        return result.processed ? 'handled' : 'empty';
      } catch (_error) {
        // Never log tokens, endpoints, account data or remote error bodies.
        failures = Math.min(failures + 1, 6);
        nextAllowed = Math.min(Number.MAX_SAFE_INTEGER,
          started + Math.min(300000, INTERVAL_MS * (2 ** failures)));
        return 'unavailable';
      } finally { running = false; }
    }
    function stop() { stopped = true; }
    return Object.freeze({tick,stop});
  }
  return Object.freeze({ privateOrigin, globalCommand, createCommandProcessor,
    localPollingSettings, commandEnvelope, createCommandPoller });
});
