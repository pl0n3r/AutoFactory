/* AutoFactory #156: opt-in localhost state publisher. Pure contract + injected ports. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotLocalPublisher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const HOST = 'http://127.0.0.1:8777/*';
  const ENDPOINT = 'http://127.0.0.1:8777/api/af';
  const FLAG = 'factoryControlLocalPublishingEnabled';
  const INSTANCE = 'factoryControlLocalInstanceId';
  const ALARM = 'factory-control-local-publish';
  const STATES = Object.freeze(['activo', 'inactivo', 'limite', 'sesion_cerrada', 'desconocido']);
  const REASONS = Object.freeze(['activo', 'esperando_pacing', 'limite_horario',
    'circuit_breaker', 'envio_ambiguo_5min', 'sesion_cerrada', 'pausa_manual',
    'sin_trabajo', 'desconocido']);
  const FIELDS = Object.freeze(['instance_id', 'label', 'state', 'current_task',
    'chats_open', 'limit_resets_at', 'idle_reason', 'idle_since', 'chats', 'run_id']);
  const REQUIRED = Object.freeze(['instance_id', 'label', 'state', 'chats_open', 'idle_reason']);
  const plain = value => value !== null && typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const iso = value => typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
  const id = value => typeof value === 'string' &&
    /^[A-Za-z0-9_.:-]{3,64}$/.test(value);
  const label = value => typeof value === 'string' &&
    /^[A-Za-z0-9 _.-]{1,40}$/.test(value);

  const CHAT_STATES = Object.freeze(['generando', 'esperando_envio', 'detenido',
    'error', 'limite', 'sesion_cerrada', 'desconocido']);
  // Opaque ids and coarse states only: never titles, text, URLs or conversation ids.
  const PHASES = Object.freeze(['trabajando', 'esperando_externo', 'termino', 'bloqueado', 'desconocido']);
  function chatsFrom(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const item of list.slice(0, 12)) {
      if (!plain(item) || typeof item.chat_id !== 'string' ||
          !/^t[0-9]{1,10}$/.test(item.chat_id)) continue;
      const chat = { chat_id: item.chat_id,
        state: CHAT_STATES.includes(item.state) ? item.state : 'desconocido' };
      if (typeof item.current_task === 'string' &&
          /^[A-Za-z][A-Za-z0-9_-]{0,39}#[1-9]\d{0,9}$/.test(item.current_task)) {
        chat.current_task = item.current_task;
      }
      chat.phase = PHASES.includes(item.phase) ? item.phase : 'desconocido';
      chat.refs = Array.isArray(item.refs) ? item.refs.filter(n => Number.isSafeInteger(n) && n > 0 && n < 1000000).slice(0, 6) : [];
      chat.directed = item.directed === true;
      out.push(Object.freeze(chat));
    }
    return out;
  }

  function payloadFrom(value) {
    if (!plain(value)) throw new TypeError('invalid state source');
    const own = Reflect.ownKeys(value);
    if (own.some(key => typeof key !== 'string' || !FIELDS.includes(key)) ||
        REQUIRED.some(key => !Object.hasOwn(value, key))) {
      throw new TypeError('unknown or missing state field');
    }
    const fields = Object.create(null);
    for (const key of own) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        throw new TypeError('state getters forbidden');
      }
      fields[key] = descriptor.value;
    }
    if (!id(fields.instance_id) || !label(fields.label) ||
        !Number.isSafeInteger(fields.chats_open) ||
        fields.chats_open < 0 || fields.chats_open > 99) {
      throw new TypeError('invalid state values');
    }
    const state = STATES.includes(fields.state) ? fields.state : 'desconocido';
    const reason = REASONS.includes(fields.idle_reason) ? fields.idle_reason : 'desconocido';
    const payload = {
      instance_id: fields.instance_id,
      label: fields.label,
      state,
      chats_open: fields.chats_open,
      idle_reason: reason
    };
    if (typeof fields.current_task === 'string' &&
        /^[A-Za-z][A-Za-z0-9_-]{0,39}#[1-9]\d{0,9}$/.test(fields.current_task)) {
      payload.current_task = fields.current_task;
    }
    if (iso(fields.idle_since)) payload.idle_since = fields.idle_since;
    if (id(fields.run_id)) payload.run_id = fields.run_id;
    if (Object.hasOwn(fields, 'chats')) payload.chats = chatsFrom(fields.chats);
    if ((state === 'limite' || state === 'sesion_cerrada') &&
        iso(fields.limit_resets_at)) {
      payload.limit_resets_at = fields.limit_resets_at;
    }
    return Object.freeze(payload);
  }

  function createPublisher({ now, enabled, permission, snapshot, post, report, timers } = {}) {
    if (![now, enabled, permission, snapshot, post].every(x => typeof x === 'function')) {
      throw new TypeError('publisher ports required');
    }
    let nextAllowed = 0;
    let failures = 0;
    let inFlight = false;
    const schedule = timers?.setTimeout || setTimeout;
    const unschedule = timers?.clearTimeout || clearTimeout;
    async function publish() {
      if (inFlight) return false;
      inFlight = true;
      let step = 'inicio';
      let expired = false;
      let watchdog;
      // Abort an in-flight fetch on expiry when the receiving port supports it.
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const note = (ok, detail) => {
        try { if (typeof report === 'function') report({ ok, step, detail }); } catch (_e) { /* diagnostics only */ }
      };
      const work = (async () => {
        try {
          const current = now();
          if (!Number.isSafeInteger(current) || current < 0 ||
              current < nextAllowed) return false;
          step = 'opcion';
          const optedIn = await enabled();
          if (expired) return false;
          if (!optedIn) { note(false, 'opción apagada'); return false; }
          step = 'permiso';
          const granted = await permission();
          if (expired) return false;
          if (!granted) { note(false, 'sin permiso 127.0.0.1'); return false; }
          step = 'pestañas';
          const result = await snapshot();
          if (expired) return false; // Never post a stale snapshot after watchdog expiry.
          const payload = payloadFrom(result);
          step = 'envio';
          // Opt-in may be revoked while gathering the snapshot. Never transmit
          // from a stale permission/flag read, even on an in-flight alarm tick.
          const stillEnabled = await enabled();
          if (expired || !stillEnabled) return false;
          const stillGranted = await permission();
          if (expired || !stillGranted) return false;
          const sent = await post(payload, controller?.signal);
          if (expired) return false; // Late I/O cannot clear backoff or report success.
          if (sent !== true) throw new TypeError('local receiver unavailable');
          note(true, 'enviado');
          failures = 0;
          nextAllowed = current + 30_000;
          return true;
        } catch (_error) {
          if (expired) return false;
          // Keep the existing failure backoff, independent of watchdog recovery.
          note(false, String(_error?.name || 'Error').slice(0, 30));
          failures = Math.min(failures + 1, 5);
          try {
            nextAllowed = Math.max(nextAllowed,
              now() + Math.min(600_000, 30_000 * (2 ** failures)));
          } catch (_ignored) { nextAllowed = Number.MAX_SAFE_INTEGER; }
          return false;
        }
      })();
      // A non-settling port must not keep inFlight set across all later alarms.
      // Timeout recovery is not an HTTP error and does not advance backoff.
      const timeout = new Promise(resolve => {
        watchdog = schedule(() => {
          expired = true;
          controller?.abort();
          note(false, 'watchdog 60s');
          resolve(false);
        }, 60_000);
      });
      try {
        return await Promise.race([work, timeout]);
      } finally {
        expired = true;
        unschedule(watchdog);
        inFlight = false;
      }
    }
    function reset() { nextAllowed = 0; failures = 0; }
    return Object.freeze({ publish, payloadFrom, reset });
  }

  function installBackground(root = globalThis) {
    const extension = root.chrome || root.browser;
    if (!extension?.storage?.local || !extension?.alarms ||
        !extension?.permissions || !extension?.tabs || typeof root.fetch !== 'function') {
      return false; // Missing permission or runtime capability never enables traffic.
    }
    // Both callback-based Chrome and Promise-based Safari APIs are supported.
    function call(target, method, ...args) {
      return new Promise(resolve => {
        let settled = false;
        const done = value => { if (!settled) { settled = true; resolve(value); } };
        try {
          const result = target[method](...args, done);
          if (result?.then) result.then(done, () => done(null));
        } catch (_error) {
          // Promise-only Safari APIs reject an extra callback argument.
          try {
            const result = target[method](...args);
            if (result?.then) result.then(done, () => done(null));
            else done(null);
          } catch (_again) { done(null); } // NOSONAR: Unavailable API fails closed.
        }
      });
    }
    const schedule = typeof root.setTimeout === 'function' ?
      root.setTimeout.bind(root) : setTimeout;
    const unschedule = typeof root.clearTimeout === 'function' ?
      root.clearTimeout.bind(root) : clearTimeout;
    async function callWithin(timeoutMs, target, method, ...args) {
      let timer;
      try {
        return await Promise.race([
          call(target, method, ...args),
          new Promise(resolve => { timer = schedule(() => resolve(null), timeoutMs); })
        ]);
      } finally {
        unschedule(timer);
      }
    }
    let runId = root.crypto?.randomUUID?.() || 'run-initial';
    const enabled = async () => {
      const stored = await call(extension.storage.local, 'get', { [FLAG]: false });
      return stored?.[FLAG] === true;
    };
    const permission = async () =>
      await call(extension.permissions, 'contains', { origins: [HOST] }) === true;
    async function snapshot() {
      const stored = await call(extension.storage.local, 'get', { [INSTANCE]: null });
      let instance_id = stored?.[INSTANCE];
      if (!id(instance_id)) {
        instance_id = root.crypto?.randomUUID?.();
        if (!id(instance_id)) throw new TypeError('missing opaque instance ID');
        await call(extension.storage.local, 'set', { [INSTANCE]: instance_id });
      }
      const found = await call(extension.tabs, 'query', { url: ['https://chatgpt.com/*'] });
      if (!Array.isArray(found)) throw new TypeError('tab snapshot unavailable');
      const tabs = found.filter(t => Number.isSafeInteger(t?.id) && t.id >= 0).slice(0, 99);
      const chats = [];
      const observed = await Promise.all(tabs.map(async tab => {
        // A frozen tab is UNKNOWN after 4 s, never an indefinitely pending report.
        const signal = await callWithin(4_000, extension.tabs, 'sendMessage',
          tab.id, { type: 'autopilot:get-status' });
        // No free text, URLs or account details from content scripts are read.
        const flag = typeof signal?.enabled === 'boolean' ? signal.enabled : null;
        const text = typeof signal?.status === 'string' ? signal.status.toLowerCase() : '';
        chats.push({ chat_id: 't' + tab.id, phase: signal?.phase, refs: signal?.refs, directed: signal?.directed === true,
          state: flag === null ? 'desconocido' : flag === false ? 'detenido' : /dirigido: esperando orden/.test(text) || (signal?.directed === true && signal?.busy === false && !/no disponible|recuperaci[oó]n|protecci[oó]n activa|no encontrado|recarga|l[ií]mite|sesi[oó]n/.test(text)) ? 'esperando_envio' : /no disponible|recuperaci[oó]n|protecci[oó]n activa|no encontrado|recarga/.test(text) ? 'error' : /l[ií]mite/.test(text) ? 'limite'
            : /sesi[oó]n/.test(text) ? 'sesion_cerrada' : flag ? 'generando' : 'detenido' });
        return flag;
      }));
      const complete = observed.length === tabs.length && observed.every(x => x !== null);
      const active = observed.some(x => x === true);
      const state = active ? 'activo' :
        complete ? 'inactivo' : 'desconocido';
      return {
        instance_id, label: 'AutoFactory', state, chats_open: tabs.length,
        idle_reason: active ? 'activo' : complete ? 'pausa_manual' : 'desconocido',
        run_id: runId, chats
      };
    }
    const post = async (payload, signal) => {
      const response = await root.fetch(ENDPOINT, {
        signal,
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', mode: 'cors', redirect: 'error', cache: 'no-store',
        referrerPolicy: 'no-referrer', body: JSON.stringify(payload)
      });
      const ok = response?.ok === true;
      if (ok) void sendLogs(payload.instance_id);
      return ok;
    };
    // Forward the already-sanitized diagnostic log (event names, codes, routes;
    // no chat text) so the local orchestrator can read what recoveries happen.
    const CURSOR = 'factoryControlLogCursor';
    async function sendLogs(instanceId) {
      try {
        const stored = await call(extension.storage.local, 'get', { diagnosticLog: [], [CURSOR]: '' });
        const all = Array.isArray(stored?.diagnosticLog) ? stored.diagnosticLog : [];
        const cursor = typeof stored?.[CURSOR] === 'string' ? stored[CURSOR] : '';
        const fresh = all.filter(e => typeof e?.at === 'string' && e.at > cursor).slice(-50);
        if (!fresh.length) return;
        const response = await root.fetch(ENDPOINT + '/log', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'omit', mode: 'cors', redirect: 'error', cache: 'no-store',
          referrerPolicy: 'no-referrer', body: JSON.stringify({ instance_id: instanceId, entries: fresh })
        });
        if (response?.ok === true) {
          await call(extension.storage.local, 'set', { [CURSOR]: fresh[fresh.length - 1].at });
        }
      } catch (_error) { /* diagnostics only */ }
    }
    const report = info => {
      try {
        void call(extension.storage.local, 'set', { factoryControlLocalLastPublish:
          { at: Date.now(), ok: info.ok === true, step: String(info.step), detail: String(info.detail) } });
      } catch (_e) { /* diagnostics only */ }
    };
    const publisher = createPublisher({ now: Date.now, enabled, permission, snapshot, post, report,
      timers: { setTimeout: schedule, clearTimeout: unschedule } });
    // Pressing Play starts a new run: announce the detected chats right away.
    extension.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes.masterEnabled?.newValue === true) {
        runId = root.crypto?.randomUUID?.() || runId;
        publisher.reset?.();
        void publisher.publish();
      }
    });
    async function reconcile() {
      try {
        if (await enabled() && await permission()) {
          // Chrome MV3 alarms.create is Promise/void, with no callback parameter.
          const created = extension.alarms.create(ALARM, { periodInMinutes: 0.5 });
          if (created?.then) await created;
          void publisher.publish();
        } else {
          await call(extension.alarms, 'clear', ALARM);
        }
      } catch (_ignored) { /* No impact on autopilot. */ }
    }
    extension.alarms.onAlarm?.addListener(alarm => {
      if (alarm?.name === ALARM) void publisher.publish();
    });
    extension.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && Object.hasOwn(changes, FLAG)) void reconcile();
    });
    extension.permissions.onRemoved?.addListener(() => { void reconcile(); });
    extension.runtime?.onStartup?.addListener(() => { void reconcile(); });
    extension.runtime?.onInstalled?.addListener(() => { void reconcile(); });
    void reconcile();
    return true;
  }
  return Object.freeze({ HOST, ENDPOINT, FLAG, INSTANCE, ALARM,
    STATES, REASONS, payloadFrom, createPublisher, installBackground });
});
