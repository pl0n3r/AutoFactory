(function () {
  'use strict';
  const extensionApi = globalThis.chrome || globalThis.browser;
  const MAX_ENTRIES = 300;
  const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const HEARTBEAT_ALARM = 'autopilot-heartbeat';

  function ensureHeartbeat() {
    if (!extensionApi.alarms?.create) return;
    try { extensionApi.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 }); } catch (_error) {}
  }

  async function heartbeatTabs() {
    if (!extensionApi.tabs?.query) return;
    try {
      const tabs = await extensionApi.tabs.query({ url: ['https://chatgpt.com/*'] });
      for (const tab of tabs) {
        try {
          const result = extensionApi.tabs.sendMessage(tab.id, { type: 'autopilot:heartbeat' });
          if (result?.catch) result.catch(() => {});
        } catch (_error) {}
      }
    } catch (_error) {}
  }

  let writeQueue = Promise.resolve();
  let learningQueue = Promise.resolve();

  function normalizeLearning(memory = {}) {
    const finiteSamples = (values, maximum = 21600000) => (Array.isArray(values) ? values : [])
      .filter(value => Number.isFinite(value) && value > 0 && value <= maximum).slice(-50);
    return {
      cycles: Number(memory.cycles) || 0,
      recoveries: Number(memory.recoveries) || 0,
      failures: Number(memory.failures) || 0,
      startupSamplesMs: finiteSamples(memory.startupSamplesMs, 600000),
      responseSamplesMs: finiteSamples(memory.responseSamplesMs),
      errorsByCode: { ...(memory.errorsByCode || {}) },
      actionSuccess: { ...(memory.actionSuccess || {}) }
    };
  }

  function applyLearningEvent(memory, message) {
    const next = normalizeLearning(memory);
    const durationMs = Number(message.durationMs) || 0;
    const detail = message.detail && typeof message.detail === 'object' ? message.detail : {};
    if (message.event === 'cycle') {
      next.cycles += 1;
      if (durationMs > 0) next.responseSamplesMs.push(durationMs);
    } else if (message.event === 'startup' && durationMs > 0) {
      next.startupSamplesMs.push(durationMs);
    } else if (message.event === 'recovery') next.recoveries += 1;
    else if (message.event === 'failure') next.failures += 1;
    else if (message.event === 'error' && detail.code) {
      next.errorsByCode[detail.code] = (next.errorsByCode[detail.code] || 0) + 1;
    } else if (message.event === 'action-success' && detail.code && detail.action) {
      const key = `${detail.code}:${detail.action}`;
      next.actionSuccess[key] = (next.actionSuccess[key] || 0) + 1;
    }
    next.startupSamplesMs = next.startupSamplesMs.slice(-50);
    next.responseSamplesMs = next.responseSamplesMs.slice(-50);
    return next;
  }

  function storageGet(defaults) {
    return new Promise((resolve, reject) => {
      try {
        const result = extensionApi.storage.local.get(defaults, resolve);
        if (result?.then) result.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  }
  function storageSet(values) {
    return new Promise((resolve, reject) => {
      try {
        const result = extensionApi.storage.local.set(values, resolve);
        if (result?.then) result.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  }
  // Only route categories and allowlisted diagnostics may leave the background worker.
  // The exported local log must not contain chat identifiers, free-text errors or tokens.
  const DIAGNOSTIC_EVENTS = new Set([
    'scroll-failure', 'front-stop', 'status', 'conversation-mode', 'reasoning-level',
    'send-start', 'send-control-missing', 'send-confirmed', 'circuit-reset',
    'recovery', 'human-required', 'circuit-open', 'draft-cleared', 'failure',
    'enabled-change', 'content-loaded'
  ]);
  const DIAGNOSTIC_TEXT = new Set([
    'code', 'action', 'kind', 'requested', 'result', 'fallback', 'reason',
    'source', 'version'
  ]);
  const DIAGNOSTIC_BOOLEAN = new Set(['enabled', 'backgroundTabs', 'persistentState']);
  const DIAGNOSTIC_NUMBER = new Set(['promptLength', 'attempt', 'intervalMinutes']);

  function safeDetails(details) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
    const clean = {};
    for (const [key, value] of Object.entries(details)) {
      if (DIAGNOSTIC_TEXT.has(key) && typeof value === 'string' &&
          /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) clean[key] = value;
      else if (DIAGNOSTIC_BOOLEAN.has(key) && typeof value === 'boolean') clean[key] = value;
      else if (DIAGNOSTIC_NUMBER.has(key) && Number.isSafeInteger(value) &&
          value >= 0 && value <= 10000000) clean[key] = value;
    }
    return clean;
  }

  function safeRoute(path) {
    if (typeof path !== 'string') return '/other';
    if (path === '/') return '/';
    if (/^\/c\/[^/]+\/?$/.test(path)) return '/c/:id';
    return '/other';
  }

  function safeEntry(entry) {
    const time = Date.parse(entry?.at || '');
    return {
      at: Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString(),
      event: DIAGNOSTIC_EVENTS.has(entry?.event) ? entry.event : 'unknown',
      tabId: Number.isSafeInteger(entry?.tabId) && entry.tabId >= 0 ? entry.tabId : null,
      windowId: Number.isSafeInteger(entry?.windowId) && entry.windowId >= 0 ? entry.windowId : null,
      path: safeRoute(entry?.path),
      details: safeDetails(entry?.details)
    };
  }

  function append(entry, sender) {
    writeQueue = writeQueue.then(async () => {
      const { diagnosticLog = [] } = await storageGet({ diagnosticLog: [] });
      let path = '/other';
      try {
        const url = new URL(sender?.tab?.url || '');
        if (url.origin === 'https://chatgpt.com') path = url.pathname;
      } catch (_error) {}
      const retainedLog = (Array.isArray(diagnosticLog) ? diagnosticLog : [])
        .filter(item => {
          const timestamp = Date.parse(item?.at || '');
          return Number.isFinite(timestamp) && Date.now() - timestamp <= MAX_LOG_AGE_MS;
        })
        .map(safeEntry);
      retainedLog.push(safeEntry({
        at: new Date().toISOString(),
        event: entry?.event,
        tabId: sender?.tab?.id,
        windowId: sender?.tab?.windowId,
        path,
        details: entry?.details
      }));
      await storageSet({ diagnosticLog: retainedLog.slice(-MAX_ENTRIES) });
    }).catch(() => {});
  }

  ensureHeartbeat();
  extensionApi.runtime.onInstalled?.addListener(ensureHeartbeat);
  extensionApi.runtime.onStartup?.addListener(ensureHeartbeat);
  extensionApi.alarms?.onAlarm.addListener(alarm => {
    if (alarm?.name === HEARTBEAT_ALARM) heartbeatTabs();
  });

  extensionApi.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === 'autopilot:log') {
      append(message, sender);
      reply({ ok: true });
      return;
    }
    if (message?.type === 'autopilot:learning-event') {
      learningQueue = learningQueue.then(async () => {
        const { learning = {} } = await storageGet({ learning: {} });
        const updated = applyLearningEvent(learning, message);
        await storageSet({ learning: updated });
        return updated;
      });
      learningQueue.then(learning => reply({ ok: true, learning }))
        .catch(error => reply({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === 'autopilot:get-log') {
      writeQueue.then(() => storageGet({ diagnosticLog: [] }))
        .then(({ diagnosticLog }) => reply({ entries: (Array.isArray(diagnosticLog) ? diagnosticLog : []).slice(-MAX_ENTRIES).map(safeEntry) }))
        .catch(error => reply({ entries: [], error: error.message }));
      return true;
    }
    if (message?.type === 'autopilot:clear-log') {
      writeQueue = writeQueue.then(() => storageSet({ diagnosticLog: [] }));
      writeQueue.then(() => reply({ ok: true }));
      return true;
    }
  });

  const FACTORY_CONTROL_INSTANCE_RUNTIME_ENABLED = false;

  function storageRemove(key) {
    return new Promise((resolve, reject) => {
      try {
        const result = extensionApi.storage.local.remove(key, resolve);
        if (result?.then) result.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  }

  function localFactoryControlAdapters() {
    return Object.freeze({
      listChatTabs: async () => {
        const tabs = await extensionApi.tabs.query({ url: ['https://chatgpt.com/*'] });
        return tabs.map(tab => tab.id)
          .filter(tabId => Number.isSafeInteger(tabId) && tabId >= 0);
      },
      sendTab: async (tabId, message) => {
        const response = await extensionApi.tabs.sendMessage(tabId, message);
        return Object.freeze({ ok: response?.ok === true });
      },
      loadMasterEnabled: async () => {
        const state = await storageGet({ factoryControlMasterEnabledV2: false });
        return state.factoryControlMasterEnabledV2 === true;
      },
      saveMasterEnabled: async enabled => {
        if (typeof enabled !== 'boolean') throw new TypeError('Invalid master state');
        await storageSet({ factoryControlMasterEnabledV2: enabled });
      }
    });
  }

  async function initializeFactoryControlInstanceRuntime() {
    if (!FACTORY_CONTROL_INSTANCE_RUNTIME_ENABLED) return null;
    const protocol = globalThis.ChatGPTAutopilotFactoryProtocol;
    const authorization = globalThis.ChatGPTAutopilotFactoryAuthorization;
    const ledgerApi = globalThis.ChatGPTAutopilotFactoryLedger;
    const instanceApi = globalThis.ChatGPTAutopilotFactoryInstance;
    const runtimeApi = globalThis.ChatGPTAutopilotFactoryRuntime;
    if (!protocol || !authorization || !ledgerApi || !instanceApi || !runtimeApi) {
      throw new Error('Factory Control local modules unavailable');
    }

    const localStorage = Object.freeze({
      get: async key => (await storageGet({ [key]: null }))[key],
      set: async (key, value) => storageSet({ [key]: value }),
      remove: storageRemove
    });
    const browser = globalThis.browser && !globalThis.chrome ? 'safari' : 'chrome';
    const version = extensionApi.runtime.getManifest().version;
    const instanceStore = instanceApi.createInstanceStore({
      storage: localStorage,
      uuid: () => globalThis.crypto.randomUUID(),
      now: Date.now,
      browser,
      extensionVersion: version
    });
    const snapshot = await instanceStore.safeSnapshot();
    if (!snapshot) return null;

    const adapters = localFactoryControlAdapters();
    const authorizer = authorization.createInstanceCommandAuthorizer({
      loadVerifiedGrant: async () => {
        const state = await instanceStore.load();
        if (!state?.grant) throw new Error('Instance grant unavailable');
        return {
          instanceId: state.instanceId,
          expiresAt: state.grant.expiresAt,
          revoked: state.grant.revoked,
          actions: [...state.grant.actions],
          tabIds: await adapters.listChatTabs()
        };
      },
      now: Date.now
    });
    const ledgerKey = 'factoryControlInstanceLedgerV2:' + snapshot.instanceId;
    const ledger = ledgerApi.createInstanceLedger({
      instanceId: snapshot.instanceId,
      load: async () => (await storageGet({ [ledgerKey]: [] }))[ledgerKey],
      save: async receipts => storageSet({ [ledgerKey]: receipts })
    });
    return runtimeApi.createInstanceRuntime({
      protocol,
      authorizer,
      ledger,
      instanceStore,
      ...adapters,
      now: Date.now
    });
  }

  if (FACTORY_CONTROL_INSTANCE_RUNTIME_ENABLED) {
    initializeFactoryControlInstanceRuntime().catch(() => {});
  }

})();
