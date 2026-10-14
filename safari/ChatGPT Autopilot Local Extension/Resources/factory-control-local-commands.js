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

  // Browser-port adapter for the LAN transport. No side effects on import and
  // no polling unless the caller explicitly installs and invokes tick().
  // A missing authenticated login/usage signal deliberately denies 'start'.
  function createBrowserCommandRuntime({ storage, permissions, tabs, fetch, now,
    allowedToStart = async () => false } = {}) {
    if (!storage || !permissions || !tabs ||
        typeof storage.get !== 'function' || typeof storage.set !== 'function' ||
        typeof permissions.contains !== 'function' ||
        typeof tabs.query !== 'function' || typeof tabs.sendMessage !== 'function' ||
        typeof fetch !== 'function' || typeof now !== 'function' ||
        typeof allowedToStart !== 'function') {
      throw new TypeError('browser ports required');
    }
    const HOST = 'factoryControlLanOriginV1';
    const KEY = 'factoryControlLanAgentKeyV1';
    const FLAG = 'factoryControlLanCommandsEnabled';
    const INSTANCE = 'factoryControlLocalInstanceId';
    const RECEIPTS = 'factoryControlLanReceiptsV1';
    const memory = Object.freeze({ [HOST]: null, [KEY]: null,
      [FLAG]: false, [INSTANCE]: null });
    const originPattern = host => {
      privateOrigin(host);
      return 'http://' + new URL(host).hostname + '/*';
    };
    async function configuration() {
      const stored = await storage.get(memory);
      if (!stored || stored[FLAG] !== true) return null;
      return localPollingSettings({
        host: stored[HOST], agentKey: stored[KEY], instanceId: stored[INSTANCE]
      });
    }
    async function permitted(host) {
      return await permissions.contains({ origins: [originPattern(host)] }) === true;
    }
    async function enabled() {
      const config = await configuration();
      return !!config && await permitted(config.host);
    }
    async function request(url, key, method = 'GET', body) {
      const options = {
        method, headers: { 'X-Agent-Key': key },
        credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer'
      };
      if (method === 'POST') {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      const response = await fetch(url, options);
      if (!response || response.ok !== true) throw new TypeError('transport unavailable');
      return response;
    }
    // Bind each ACK to the exact server/key/instance that supplied the GET.
    // A settings rotation during apply cannot transfer command ownership.
    let source = null;
    async function fetchPending({ origin, instanceId, agentKey }) {
      source = null;
      privateOrigin(origin);
      const url = origin + '/api/af/commands?instance_id=' +
        encodeURIComponent(instanceId);
      const response = await request(url, agentKey);
      const type = response.headers?.get?.('content-type');
      if (typeof type !== 'string' || !/^application\/json(?:\s*;|$)/i.test(type)) {
        throw new TypeError('non-JSON response');
      }
      const size = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(size) && size > 32768) throw new TypeError('oversize');
      const text = await response.text();
      if (typeof text !== 'string' || text.length > 32768) {
        throw new TypeError('oversize');
      }
      const parsed = JSON.parse(text);
      source = Object.freeze({ origin, instanceId, agentKey });
      return parsed;
    }
    // Receipt IDs belong to the coordinator that originated each GET.
    // Numeric-only receipts from the old format still deny replay (fail closed)
    // until an operator safely reconciles them; never silently discard them.
    function receiptKey(id) {
      if (!source || !Number.isSafeInteger(id) || id < 1) return null;
      return source.origin + '|' + source.instanceId + '|' + id;
    }
    function validReceiptKey(key) {
      if (/^[1-9]\d{0,15}$/.test(key)) return Number.isSafeInteger(Number(key));
      const match = /^(http:\/\/[0-9.]+:[0-9]+)\|([A-Za-z0-9_.:-]{3,64})\|([1-9]\d{0,15})$/.exec(key);
      if (!match || !Number.isSafeInteger(Number(match[3]))) return false;
      try { privateOrigin(match[1]); return true; } catch (_error) { return false; }
    }
    async function receipts() {
      const stored = await storage.get({ [RECEIPTS]: null });
      const record = stored?.[RECEIPTS];
      if (record === null || record === undefined) return Object.create(null);
      if (!isObject(record) || Reflect.ownKeys(record).length > 512) {
        throw new TypeError('untrusted receipt ledger');
      }
      for (const key of Reflect.ownKeys(record)) {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (typeof key !== 'string' || !validReceiptKey(key) ||
            !descriptor || !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            descriptor.value !== true) {
          throw new TypeError('untrusted receipt');
        }
      }
      return record;
    }
    async function seenReceipt(id) {
      const key = receiptKey(id);
      if (!key) return true;
      const record = await receipts();
      return record[key] === true || record[String(id)] === true;
    }
    async function mark(id) {
      const key = receiptKey(id);
      if (!key) return false;
      const prev = await receipts();
      if (Object.keys(prev).length >= 512 ||
          prev[key] === true || prev[String(id)] === true) return false;
      const next = Object.assign(Object.create(null), prev, { [key]: true });
      await storage.set({ [RECEIPTS]: next });
      return (await receipts())[key] === true;
    }
    async function apply(want) {
      if (want !== 'stop' && want !== 'start') return false;
      if (want === 'start' && await allowedToStart() !== true) return false;
      const active = want === 'start';
      await storage.set({ masterEnabled: active });
      const found = await tabs.query({ url: ['https://chatgpt.com/*'] });
      if (!Array.isArray(found) || found.length > 99) return false;
      for (const tab of found) {
        if (!Number.isSafeInteger(tab?.id) || tab.id < 0) return false;
        const result = await tabs.sendMessage(tab.id,
          { type: 'autopilot:set-enabled', enabled: active });
        if (result?.ok !== true || result?.enabled !== active) return false;
      }
      return true;
    }
    async function ack(id) {
      const expected = source;
      const local = await configuration();
      if (!expected || !local ||
          local.host !== expected.origin ||
          local.instanceId !== expected.instanceId ||
          local.agentKey !== expected.agentKey ||
          await permitted(expected.origin) !== true) return false;
      await request(expected.origin + '/api/af/ack', expected.agentKey, 'POST',
        { id, instance_id: expected.instanceId });
      return true;
    }
    const processor = createCommandProcessor({
      enabled, allowedToStart, apply,
      seen: seenReceipt,
      mark, ack
    });
    const poller = createCommandPoller({
      enabled, permission: permitted, configuration, fetchPending,
      process: async command => processor.process({
        id: command.id, chat_id: null, want: command.want
      }), now
    });
    return Object.freeze({ tick: poller.tick, stop: poller.stop });
  }


  // Chrome MV3 / Safari service worker wiring. The popup keeps this opt-in
  // disabled by default; alarms cannot grant permission or start processing.
  function installBackground(root = globalThis) {
    const ext = root.chrome || root.browser;
    if (!ext?.storage?.local || !ext?.storage?.onChanged ||
        !ext?.permissions || !ext?.alarms?.onAlarm ||
        !ext?.tabs || typeof root.fetch !== 'function' ||
        typeof ext.storage.local.get !== 'function' ||
        typeof ext.storage.local.set !== 'function' ||
        typeof ext.permissions.contains !== 'function' ||
        typeof ext.tabs.query !== 'function' ||
        typeof ext.tabs.sendMessage !== 'function') return false;

    // Promise Chrome/Safari APIs and callback variants. Any unsupported
    // / ambiguous completion rejects and cannot authorize an ACK.
    function invoke(target, method, ...args) {
      return new Promise((resolve, reject) => {
        let done = false;
        const success = value => {
          if (done) return;
          done = true;
          if (ext.runtime?.lastError) reject(new TypeError('browser API unavailable'));
          else resolve(value);
        };
        const failed = () => {
          if (!done) { done = true; reject(new TypeError('browser API unavailable')); }
        };
        try {
          const result = target[method](...args, success);
          if (result?.then) result.then(success, failed);
        } catch (_error) {
          // Safari's promise-only API may reject the callback argument.
          try {
            const result = target[method](...args);
            if (result?.then) result.then(success, failed);
            else failed();
          } catch (_again) { failed(); }
        }
      });
    }
    const adapter = createBrowserCommandRuntime({
      storage: {
        get: input => invoke(ext.storage.local, 'get', input),
        set: changes => invoke(ext.storage.local, 'set', changes)
      },
      permissions: { contains: input =>
        invoke(ext.permissions, 'contains', input) },
      tabs: {
        query: input => invoke(ext.tabs, 'query', input),
        sendMessage: (id, msg) => invoke(ext.tabs, 'sendMessage', id, msg)
      },
      fetch: (...args) => root.fetch(...args),
      now: () => root.Date?.now?.() ?? Date.now()
      // No trusted provider-login/usage signal currently wired. START denies.
    });
    const ALARM = 'factory-control-lan-commands';
    async function reconcile() {
      try {
        const saved = await invoke(ext.storage.local, 'get',
          { factoryControlLanCommandsEnabled: false });
        if (saved?.factoryControlLanCommandsEnabled !== true) {
          await invoke(ext.alarms, 'clear', ALARM).catch(() => {});
          return;
        }
        const scheduled = ext.alarms.create(ALARM, { periodInMinutes: 0.5 });
        if (scheduled?.then) await scheduled;
        void adapter.tick();
      } catch (_error) {
        // Nothing may bypass the stored opt-in and exact host permission.
      }
    }
    ext.alarms.onAlarm.addListener(alarm => {
      if (alarm?.name === ALARM) void adapter.tick();
    });
    ext.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && ['factoryControlLanCommandsEnabled',
        'factoryControlLanOriginV1', 'factoryControlLanAgentKeyV1',
        'factoryControlLocalInstanceId'].some(key => Object.hasOwn(changes, key))) {
        void reconcile();
      }
    });
    ext.permissions.onRemoved?.addListener(() => { void reconcile(); });
    ext.runtime?.onStartup?.addListener(() => { void reconcile(); });
    ext.runtime?.onInstalled?.addListener(() => { void reconcile(); });
    void reconcile();
    return true;
  }

  return Object.freeze({ privateOrigin, globalCommand, createCommandProcessor,
    localPollingSettings, commandEnvelope, createCommandPoller, createBrowserCommandRuntime, installBackground });
});
