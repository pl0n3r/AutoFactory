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
  const REPOS = Object.freeze(['Factory', 'Condor', 'GrindFlow', 'brvtal', 'ControlBot', 'AutoFactory', 'FactoryRunner']);
  function globalCommand(raw) {
    if (!isObject(raw)) return null;
    const keys = Reflect.ownKeys(raw);
    if ((keys.length !== 3 && keys.length !== 4) || keys.some(k => typeof k !== 'string' ||
        !['id', 'chat_id', 'want', 'issue', 'repo'].includes(k))) return null;
    const extra = keys.filter(k => k === 'issue' || k === 'repo');
    if ((keys.length === 4) !== (extra.length === 1)) return null;
    const values = Object.create(null);
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(raw, key);
      if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) return null;
      values[key] = d.value;
    }
    if (!Number.isSafeInteger(values.id) || values.id < 1 ||
        !(values.chat_id === null ||
          (typeof values.chat_id === 'string' && /^t[0-9]{1,9}$/.test(values.chat_id))) ||
        !['stop', 'start', 'assign'].includes(values.want)) return null;
    if (values.want === 'assign') {
      // Fixed templates only: an opaque chat plus a Repo#N reference or one of
      // the seven known repositories. No free text ever crosses this channel.
      if (values.chat_id === null || extra.length !== 1) return null;
      if (extra[0] === 'issue') {
        if (typeof values.issue !== 'string' ||
            !/^[A-Za-z][A-Za-z0-9_-]{0,39}#[1-9]\d{0,9}$/.test(values.issue)) return null;
        return Object.freeze({ id: values.id, chat_id: values.chat_id,
          want: 'assign', issue: values.issue });
      }
      if (!REPOS.includes(values.repo)) return null;
      return Object.freeze({ id: values.id, chat_id: values.chat_id,
        want: 'assign', repo: values.repo });
    }
    if (keys.length === 4) return null;
    return Object.freeze({ id: values.id, chat_id: values.chat_id, want: values.want });
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
        if (await apply(command.want, command.chat_id, command.issue || command.repo) !== true) return false;
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
    allowedToStart = async () => false,
    timeoutSignal = milliseconds => AbortSignal.timeout(milliseconds) } = {}) {
    if (!storage || !permissions || !tabs ||
        typeof storage.get !== 'function' || typeof storage.set !== 'function' ||
        typeof permissions.contains !== 'function' ||
        typeof tabs.query !== 'function' || typeof tabs.sendMessage !== 'function' ||
        typeof fetch !== 'function' || typeof now !== 'function' ||
        typeof allowedToStart !== 'function' ||
        typeof timeoutSignal !== 'function') {
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
      // A token over HTTP can leave the machine only after the transport
      // has been secured independently. Loopback alone is allowed today.
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(host)) return null;
      // Same exact pattern (with port) that the popup requested and the publisher checks.
      return host + '/*';
    };
    async function configuration() {
      const stored = await storage.get(memory);
      if (!stored || stored[FLAG] !== true) return null;
      return localPollingSettings({
        host: stored[HOST], agentKey: stored[KEY], instanceId: stored[INSTANCE]
      });
    }
    async function permitted(host) {
      const pattern = originPattern(host);
      return pattern !== null &&
        await permissions.contains({ origins: [pattern] }) === true;
    }
    async function enabled() {
      const config = await configuration();
      return !!config && await permitted(config.host);
    }
    async function request(url, key, method = 'GET', body) {
      // Defense in depth: never attach X-Agent-Key to cleartext LAN traffic.
      const target = new URL(url);
      if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') {
        throw new TypeError('cleartext remote LAN transport forbidden');
      }
      // Abort both stalled connections and bodies. If deadlines are unavailable
      // in this browser, fail closed before opening an unbounded request.
      const signal = timeoutSignal(6000);
      if (!signal || typeof signal.aborted !== 'boolean') {
        throw new TypeError('request deadline unavailable');
      }
      const options = {
        method, headers: { 'X-Agent-Key': key },
        credentials: 'omit', redirect: 'error', signal,
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
      let text;
      if (response.body && typeof response.body.getReader === 'function') {
        // Validate actual bytes while streaming; Content-Length can be absent
        // or dishonest. Never materialize an unlimited response.text().
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0;
        text = '';
        try {
          let chunk = await reader.read();
          while (chunk.done !== true) {
            if (!(chunk.value instanceof Uint8Array)) {
              throw new TypeError('invalid response stream');
            }
            bytes += chunk.value.byteLength;
            if (bytes > 32768) throw new TypeError('oversize');
            text += decoder.decode(chunk.value, { stream: true });
            chunk = await reader.read();
          }
          text += decoder.decode();
        } catch (error) {
          try { await reader.cancel(); } catch (_ignored) {}
          throw error;
        } finally {
          reader.releaseLock();
        }
      } else {
        // Synthetic responses used by the offline adapter tests. Real browser
        // Fetch responses carry a readable body stream for nonempty payloads.
        text = await response.text();
      }
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
    async function apply(want, chatId = null, issue = null) {
      if (want !== 'stop' && want !== 'start' && want !== 'assign') return false;
      if (want === 'assign' && (chatId === null || !issue)) return false;
      if (want === 'start' && await allowedToStart() !== true) return false;
      const active = want === 'start';
      if (chatId === null && want !== 'assign') await storage.set({ masterEnabled: active });
      // tabs.query can itself remain pending when the browser is suspended.
      // Bound discovery separately from the per-tab send deadlines.
      const querySignal = timeoutSignal(6000);
      if (!querySignal || typeof querySignal.aborted !== 'boolean' ||
          typeof querySignal.addEventListener !== 'function' ||
          typeof querySignal.removeEventListener !== 'function') return false;
      const found = await new Promise(resolve => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          querySignal.removeEventListener('abort', onAbort);
          resolve(value);
        };
        const onAbort = () => finish(null);
        querySignal.addEventListener('abort', onAbort, { once: true });
        if (querySignal.aborted) { finish(null); return; }
        try {
          Promise.resolve(tabs.query({ url: ['https://chatgpt.com/*'] }))
            .then(finish, () => finish(null));
        } catch (_error) { finish(null); }
      });
      if (!Array.isArray(found) || found.length > 99) return false;
      // A stale/broken tab must not prevent STOP reaching other tabs.
      // Fan out to all valid tabs, but acknowledge only a complete success.
      // Per-chat order: only the matching opaque chat id; a missing chat is a
      // harmless no-op that is still acknowledged (idempotent).
      const targets = chatId === null ? found
        : found.filter(tab => Number.isSafeInteger(tab?.id) && 't' + tab.id === chatId);
      const outcomes = await Promise.all(targets.map(async tab => {
        if (!Number.isSafeInteger(tab?.id) || tab.id < 0) return false;
        // A tab may never settle (e.g. a suspended content script). Bound each
        // response, so the overall STOP can finish without an unsafe ACK.
        const signal = timeoutSignal(6000);
        if (!signal || typeof signal.aborted !== 'boolean' ||
            typeof signal.addEventListener !== 'function' ||
            typeof signal.removeEventListener !== 'function') return false;
        return await new Promise(resolve => {
          let settled = false;
          const onAbort = () => finish(false);
          const finish = ok => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            resolve(ok);
          };
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) { finish(false); return; }
          try {
            Promise.resolve(tabs.sendMessage(tab.id,
              want === 'assign'
                ? (REPOS.includes(issue) ? { type: 'autopilot:assign', repo: issue }
                  : { type: 'autopilot:assign', issue })
                : { type: 'autopilot:set-enabled', enabled: active }))
              .then(result => finish(want === 'assign' ? result?.ok === true
                : result?.ok === true && result?.enabled === active),
              () => finish(false));
          } catch (_error) { finish(false); }
        });
      }));
      return outcomes.every(value => value === true);
    }
    async function ack(id) {
      const expected = source;
      const local = await configuration();
      if (!expected || !local ||
          local.host !== expected.origin ||
          local.instanceId !== expected.instanceId ||
          local.agentKey !== expected.agentKey ||
          await permitted(expected.origin) !== true) return false;
      // Permission checks are asynchronous: opt-in or credentials may change
      // while awaiting the browser API. Refresh immediately before POST.
      const current = await configuration();
      if (!current || current.host !== expected.origin ||
          current.instanceId !== expected.instanceId ||
          current.agentKey !== expected.agentKey) return false;
      // A host grant can disappear during the last storage read. Check it
      // again, then refresh consent/settings before any POST side effect.
      if (await permitted(expected.origin) !== true) return false;
      const final = await configuration();
      if (!final || final.host !== expected.origin ||
          final.instanceId !== expected.instanceId ||
          final.agentKey !== expected.agentKey) return false;
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
        id: command.id, chat_id: command.chat_id ?? null, want: command.want,
        ...(command.issue ? { issue: command.issue } : {}),
        ...(command.repo ? { repo: command.repo } : {})
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
    // Diagnostics only: fixed result words, never keys, URLs or chat data.
    async function pollNow() {
      let result = 'error';
      try { result = String(await adapter.tick()); } catch (_error) { result = 'error'; }
      if (result === 'disabled') {
        try {
          const st = await invoke(ext.storage.local, 'get', { factoryControlLanOriginV1: null,
            factoryControlLanAgentKeyV1: null, factoryControlLanCommandsEnabled: false,
            factoryControlLocalInstanceId: null });
          const okKey = typeof st.factoryControlLanAgentKeyV1 === 'string' &&
            st.factoryControlLanAgentKeyV1.length >= 12;
          const okInst = typeof st.factoryControlLocalInstanceId === 'string';
          const perm = await invoke(ext.permissions, 'contains',
            { origins: [String(st.factoryControlLanOriginV1) + '/*'] }).catch(() => false);
          result = 'disabled:' + (st.factoryControlLanCommandsEnabled !== true ? 'opcion'
            : !okKey ? 'clave' : !okInst ? 'instancia' : perm !== true ? 'permiso' : 'otro');
        } catch (_error) { /* keep plain result */ }
      }
      try {
        await invoke(ext.storage.local, 'set', { factoryControlLanLastPoll:
          { at: Date.now(), result: result.slice(0, 20) } });
      } catch (_error) { /* diagnostics only */ }
    }
    async function reconcile() {
      try {
        const saved = await invoke(ext.storage.local, 'get',
          { factoryControlLanCommandsEnabled: false });
        if (saved?.factoryControlLanCommandsEnabled !== true) {
          await invoke(ext.alarms, 'clear', ALARM).catch(() => {});
          void broadcastDirected(false);
          return;
        }
        const scheduled = ext.alarms.create(ALARM, { periodInMinutes: 0.5 });
        if (scheduled?.then) await scheduled;
        void broadcastDirected(true);
        void pollNow();
      } catch (_error) {
        // Nothing may bypass the stored opt-in and exact host permission.
      }
    }
    // While the orchestrator link is opted in, every ChatGPT tab is "directed":
    // the generic continuation prompt is never sent, only assigned issues.
    async function broadcastDirected(on) {
      try {
        const found = await invoke(ext.tabs, 'query', { url: ['https://chatgpt.com/*'] });
        for (const tab of (Array.isArray(found) ? found : []).slice(0, 99)) {
          if (Number.isSafeInteger(tab?.id)) {
            invoke(ext.tabs, 'sendMessage', tab.id,
              { type: 'autopilot:directed', on }).catch(() => {});
          }
        }
      } catch (_error) { /* tabs unavailable */ }
    }
    ext.alarms.onAlarm.addListener(alarm => {
      if (alarm?.name === ALARM) { void broadcastDirected(true); void pollNow(); }
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
