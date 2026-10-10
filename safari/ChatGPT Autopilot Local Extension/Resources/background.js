(function () {
  'use strict';
  const extensionApi = globalThis.chrome || globalThis.browser;
  const MAX_ENTRIES = 300;
  const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const HEARTBEAT_ALARM = 'autopilot-heartbeat';

  const FACTORY_CONTROL_INSTANCE_RUNTIME_ENABLED = false;
  const FACTORY_CONTROL_LOCAL_AGENT_ENABLED = false;
  const FACTORY_CONTROL_RECEIPTS_KEY = 'factoryControlInstanceReceiptsV2';

  function storageRemove(key) {
    return new Promise((resolve, reject) => {
      try {
        const result = extensionApi.storage.local.remove(key, resolve);
        if (result?.then) result.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  }

  function factoryControlStorageAdapter() {
    return Object.freeze({
      async get(key) {
        const values = await storageGet({ [key]: null });
        return values?.[key] ?? null;
      },
      async set(key, value) {
        await storageSet({ [key]: value });
      },
      async remove(key) {
        await storageRemove(key);
      }
    });
  }

  function factoryControlReceiptStore() {
    return Object.freeze({
      async load() {
        const values = await storageGet({ [FACTORY_CONTROL_RECEIPTS_KEY]: [] });
        return values?.[FACTORY_CONTROL_RECEIPTS_KEY] ?? [];
      },
      async save(receipts) {
        await storageSet({ [FACTORY_CONTROL_RECEIPTS_KEY]: receipts });
      }
    });
  }

  async function createFactoryControlInstanceRuntime() {
    if (!FACTORY_CONTROL_INSTANCE_RUNTIME_ENABLED) return null;

    const protocol = globalThis.ChatGPTAutopilotFactoryProtocol;
    const authorization = globalThis.ChatGPTAutopilotFactoryAuthorization;
    const ledgerApi = globalThis.ChatGPTAutopilotFactoryLedger;
    const instanceApi = globalThis.ChatGPTAutopilotFactoryInstance;
    const runtimeApi = globalThis.ChatGPTAutopilotFactoryRuntime;
    if (!protocol || !authorization || !ledgerApi || !instanceApi || !runtimeApi) {
      throw new Error('Factory Control runtime modules unavailable');
    }

    const storage = factoryControlStorageAdapter();
    const browser = globalThis.browser && !globalThis.chrome ? 'safari' : 'chrome';
    const extensionVersion = extensionApi.runtime.getManifest().version;
    const instanceStore = instanceApi.createInstanceStore({
      storage,
      uuid: () => globalThis.crypto.randomUUID(),
      browser,
      extensionVersion
    });
    const snapshot = await instanceStore.safeSnapshot();
    if (snapshot === null) return null;

    const listChatTabs = async () => {
      const tabs = await extensionApi.tabs.query({ url: ['https://chatgpt.com/*'] });
      return tabs
        .map(tab => tab?.id)
        .filter(tabId => Number.isSafeInteger(tabId) && tabId >= 0);
    };
    const receiptStore = factoryControlReceiptStore();
    const ledger = ledgerApi.createInstanceLedger({
      instanceId: snapshot.instanceId,
      load: receiptStore.load,
      save: receiptStore.save
    });
    const authorizer = authorization.createInstanceCommandAuthorizer({
      async loadVerifiedGrant() {
        const state = await instanceStore.load();
        if (!state?.grant) return null;
        return {
          instanceId: state.instanceId,
          expiresAt: state.grant.expiresAt,
          revoked: state.grant.revoked,
          actions: state.grant.actions,
          tabIds: await listChatTabs()
        };
      },
      now: Date.now
    });

    return runtimeApi.createInstanceRuntime({
      protocol,
      authorizer,
      ledger,
      instanceStore,
      listChatTabs,
      async sendTab(tabId, message) {
        return extensionApi.tabs.sendMessage(tabId, message);
      },
      async loadMasterEnabled() {
        const values = await storageGet({ masterEnabled: true });
        return values.masterEnabled;
      },
      async saveMasterEnabled(enabled) {
        await storageSet({ masterEnabled: enabled });
      },
      now: Date.now
    });
  }

  globalThis.ChatGPTAutopilotFactoryControlBuildAhead = Object.freeze({
    enabled: FACTORY_CONTROL_INSTANCE_RUNTIME_ENABLED,
    create: createFactoryControlInstanceRuntime
  });

  function factoryControlLocalAgentStatus() {
    const moduleLoaded = Boolean(globalThis.ChatGPTAutopilotFactoryInstanceTransport);
    return Object.freeze({
      enabled: FACTORY_CONTROL_LOCAL_AGENT_ENABLED,
      state: FACTORY_CONTROL_LOCAL_AGENT_ENABLED && moduleLoaded ? 'ready' : 'disabled',
      capabilities: Object.freeze({ pair: false, revoke: false })
    });
  }

  globalThis.ChatGPTAutopilotFactoryControlLocalAgentBuildAhead = Object.freeze({
    enabled: FACTORY_CONTROL_LOCAL_AGENT_ENABLED,
    moduleLoaded: Boolean(globalThis.ChatGPTAutopilotFactoryInstanceTransport)
  });

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
  const sharedLearningApi = globalThis.ChatGPTAutopilotSharedLearningSync;
  const sharedLearning = sharedLearningApi?.createSharedLearningSync({
    storage: {
      async get(key) { return storageGet({ [key]: null }); },
      async set(values) { return storageSet(values); }
    },
    async fetchPolicy() { return { notModified: true, policyVersion: 0 }; },
    async uploadEvents() { throw new Error('shared learning gate closed'); }
  }) || null;

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
    if (message?.type === 'autopilot:factory-control-status') {
      reply(factoryControlLocalAgentStatus());
      return;
    }
    if (message?.type === 'autopilot:factory-control-pair' ||
        message?.type === 'autopilot:factory-control-revoke') {
      reply(Object.freeze({ ok: false, code: 'disabled' }));
      return;
    }
    if (message?.type === 'autopilot:log') {
      append(message, sender);
      reply({ ok: true });
      return;
    }
    if (message?.type === 'autopilot:shared-learning-status') {
      if (!sharedLearning) { reply({ enabled: false, mode: 'off' }); return; }
      sharedLearning.snapshot().then(reply).catch(() => reply({ enabled: false, mode: 'observe', lastError: 'status_failed' }));
      return true;
    }
    if (message?.type === 'autopilot:shared-learning-reset') {
      if (!sharedLearning) { reply({ ok: false }); return; }
      sharedLearning.reset().then(state => reply({ ok: true, state })).catch(() => reply({ ok: false }));
      return true;
    }
    if (message?.type === 'autopilot:shared-learning-rollback') {
      if (!sharedLearning) { reply({ ok: false }); return; }
      sharedLearning.rollback().then(state => reply({ ok: true, state })).catch(() => reply({ ok: false }));
      return true;
    }
    if (message?.type === 'autopilot:shared-learning-outcome') {
      if (!sharedLearning) { reply({ ok: false }); return; }
      sharedLearning.record(message.outcome).then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
      return true;
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
})();
