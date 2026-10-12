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
        if (await enabled() !== true) return false;
        if (await apply(command.want) !== true) return false;
        if (await mark(command.id) !== true) return false;
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
  return Object.freeze({ privateOrigin, globalCommand, createCommandProcessor });
});
