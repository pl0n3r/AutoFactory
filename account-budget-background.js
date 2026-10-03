'use strict';

function accountBudgetSafeReasoning(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'unknown';
}

(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./account-budget.js')
      : root.ChatGPTAutopilotAccountBudget
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotAccountBudgetBackground = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (budget) {
  const SETTINGS = Object.freeze({
    accountBudgetAccountAlias: budget.DEFAULT_ACCOUNT_ALIAS,
    accountBudgetLimit: budget.DEFAULT_LIMIT,
    accountBudgetWindowMinutes: budget.DEFAULT_WINDOW_MS / 60000
  });

  function createController({ storage, now = Date.now } = {}) {
    if (!budget || typeof budget.consume !== 'function' ||
        typeof budget.refresh !== 'function' ||
        !storage || typeof storage.get !== 'function' || typeof storage.set !== 'function' ||
        typeof now !== 'function') {
      throw new TypeError('Account budget controller dependencies are required');
    }
    let queue = Promise.resolve();

    async function context() {
      const defaults = {
        [budget.STATE_KEY]: {},
        [budget.FACTORY_POLICY_KEY]: null,
        ...SETTINGS
      };
      const values = await storage.get(defaults);
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new TypeError('Invalid account budget storage response');
      }
      const timestamp = now();
      const alias = budget.accountAlias(
        values.accountBudgetAccountAlias || budget.DEFAULT_ACCOUNT_ALIAS
      );
      const policy = budget.effectivePolicy(
        values, values[budget.FACTORY_POLICY_KEY], alias, timestamp
      );
      const state = budget.normalizeState(values[budget.STATE_KEY] || {});
      return { alias, policy, state, timestamp };
    }

    async function persist(result) {
      await storage.set({
        [budget.STATE_KEY]: result.state,
        [budget.SNAPSHOT_KEY]: result.snapshot
      });
      return result;
    }

    function serial(operation) {
      const run = queue.then(operation, operation);
      queue = run.then(() => undefined, () => undefined);
      return run;
    }

    return Object.freeze({
      status() {
        return serial(async () => {
          const current = await context();
          const result = budget.refresh(
            current.state, current.alias, current.policy, current.timestamp
          );
          await persist(result);
          return { snapshot: result.snapshot };
        });
      },

      consume(input = {}) {
        return serial(async () => {
          const current = await context();
          const result = budget.consume(current.state, {
            accountAlias: current.alias,
            now: current.timestamp,
            policy: current.policy,
            reasoningLevel: accountBudgetSafeReasoning(input.reasoningLevel)
          });
          await persist(result);
          return { allowed: result.allowed, snapshot: result.snapshot };
        });
      },

      recordLimit(input = {}) {
        return serial(async () => {
          const current = await context();
          const resetAt = input.resetAt === null || input.resetAt === undefined
            ? null : input.resetAt;
          const result = budget.recordLimit(current.state, {
            accountAlias: current.alias,
            now: current.timestamp,
            policy: current.policy,
            reasoningLevel: accountBudgetSafeReasoning(input.reasoningLevel),
            resetAt
          });
          await persist(result);
          return { snapshot: result.snapshot };
        });
      }
    });
  }

  function browserStorage(extensionApi) {
    const local = extensionApi?.storage?.local;
    if (!local || typeof local.get !== 'function' || typeof local.set !== 'function') {
      throw new TypeError('Account budget storage unavailable');
    }
    return Object.freeze({
      get(defaults) {
        return new Promise((resolve, reject) => {
          try {
            const result = local.get(defaults, resolve);
            if (typeof result?.then === 'function') void result.then(resolve, reject);
          } catch (error) {
            reject(error);
          }
        });
      },
      set(values) {
        return new Promise((resolve, reject) => {
          try {
            const result = local.set(values, resolve);
            if (typeof result?.then === 'function') void result.then(resolve, reject);
          } catch (error) {
            reject(error);
          }
        });
      }
    });
  }

  const TAB_HEALTH_STATE_KEY = 'tabHealthStateV1';
  const TAB_HEALTH_LOG_KEY = 'tabHealthLogV1';
  const TAB_HEALTH_THRESHOLD_KEY = 'tabHealthStallMinutes';
  const TAB_HEALTH_DEFAULT_MINUTES = 30;
  const TAB_HEALTH_MAX_LOG = 200;
  const TAB_HEALTH_EVENTS = new Set(['send', 'reply', 'rate-limit', 'enabled']);

  function safeTabId(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function safeTabFingerprint(value) {
    const normalized = String(value || '').toLowerCase();
    return /^[0-9a-f]{8}$/.test(normalized) ? normalized : '';
  }

  function safeTabAlias(value) {
    const normalized = String(value || '');
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(normalized) && !normalized.includes('@')
      ? normalized : budget.DEFAULT_ACCOUNT_ALIAS;
  }

  function normalizeTabRecord(value = {}, tabId = null) {
    const normalizedId = safeTabId(tabId ?? value.tabId);
    return {
      tabId: normalizedId,
      accountAlias: safeTabAlias(value.accountAlias),
      lastSendAt: Math.max(0, Number(value.lastSendAt) || 0),
      lastReplyAt: Math.max(0, Number(value.lastReplyAt) || 0),
      rateLimitedSince: Math.max(0, Number(value.rateLimitedSince) || 0),
      paused: value.paused !== false,
      lastReplyFingerprint: safeTabFingerprint(value.lastReplyFingerprint),
      repeatedReplyCount: Math.max(0, Number(value.repeatedReplyCount) || 0),
      sameReplySince: Math.max(0, Number(value.sameReplySince) || 0)
    };
  }

  function normalizeTabHealthState(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const state = {};
    for (const [key, value] of Object.entries(raw)) {
      const tabId = Number(key);
      if (!Number.isSafeInteger(tabId) || tabId < 0) continue;
      state[String(tabId)] = normalizeTabRecord(value, tabId);
    }
    return state;
  }

  function recordTabEvent(rawState, event = {}) {
    const tabId = safeTabId(event.tabId);
    if (tabId === null || !TAB_HEALTH_EVENTS.has(event.type)) {
      return normalizeTabHealthState(rawState);
    }
    const state = normalizeTabHealthState(rawState);
    const key = String(tabId);
    const current = normalizeTabRecord(state[key], tabId);
    const at = Math.max(1, Number(event.at) || Date.now());
    current.accountAlias = safeTabAlias(event.accountAlias || current.accountAlias);

    if (event.type === 'send') {
      current.lastSendAt = at;
      current.paused = false;
      current.rateLimitedSince = 0;
    } else if (event.type === 'reply') {
      const fingerprint = safeTabFingerprint(event.fingerprint);
      current.lastReplyAt = at;
      current.paused = false;
      if (fingerprint && fingerprint === current.lastReplyFingerprint) {
        current.repeatedReplyCount = Math.max(1, current.repeatedReplyCount) + 1;
        current.sameReplySince = current.sameReplySince || current.lastReplyAt || at;
      } else if (fingerprint) {
        current.lastReplyFingerprint = fingerprint;
        current.repeatedReplyCount = 1;
        current.sameReplySince = at;
      } else {
        current.repeatedReplyCount = 0;
        current.sameReplySince = 0;
      }
    } else if (event.type === 'rate-limit') {
      current.rateLimitedSince = current.rateLimitedSince || at;
    } else if (event.type === 'enabled') {
      current.paused = event.enabled !== true;
    }
    state[key] = current;
    return state;
  }

  function appendTabHealthLog(rawLog, event = {}) {
    const tabId = safeTabId(event.tabId);
    if (tabId === null || !TAB_HEALTH_EVENTS.has(event.type)) {
      return Array.isArray(rawLog) ? rawLog.slice(-TAB_HEALTH_MAX_LOG) : [];
    }
    const clean = {
      at: Math.max(1, Number(event.at) || Date.now()),
      tabId,
      event: event.type
    };
    const fingerprint = safeTabFingerprint(event.fingerprint);
    if (fingerprint) clean.fingerprint = fingerprint;
    const retained = (Array.isArray(rawLog) ? rawLog : [])
      .map(item => ({
        at: Math.max(1, Number(item?.at) || 1),
        tabId: safeTabId(item?.tabId),
        event: TAB_HEALTH_EVENTS.has(item?.event) ? item.event : 'enabled',
        ...(safeTabFingerprint(item?.fingerprint)
          ? { fingerprint: safeTabFingerprint(item.fingerprint) } : {})
      }))
      .filter(item => item.tabId !== null);
    retained.push(clean);
    return retained.slice(-TAB_HEALTH_MAX_LOG);
  }

  function tabHealthSnapshot(rawState, {
    now = Date.now(),
    thresholdMinutes = TAB_HEALTH_DEFAULT_MINUTES,
    tabIds = null
  } = {}) {
    const state = normalizeTabHealthState(rawState);
    const allowedIds = Array.isArray(tabIds)
      ? new Set(tabIds.map(safeTabId).filter(value => value !== null))
      : null;
    const threshold = Math.max(1, Math.min(1440, Number(thresholdMinutes) || TAB_HEALTH_DEFAULT_MINUTES));
    const thresholdMs = threshold * 60000;
    const timestamp = Math.max(1, Number(now) || Date.now());
    const tabs = Object.values(state)
      .filter(record => !allowedIds || allowedIds.has(record.tabId))
      .map(record => {
        const noReply = record.lastSendAt > 0
          && record.lastReplyAt < record.lastSendAt
          && timestamp - record.lastSendAt >= thresholdMs;
        const repeatedReply = record.repeatedReplyCount >= 2
          && record.sameReplySince > 0
          && timestamp - record.sameReplySince >= thresholdMs;
        return Object.freeze({
          ...record,
          stalled: noReply || repeatedReply,
          stalledReason: noReply ? 'no-reply' : repeatedReply ? 'repeated-reply' : null
        });
      })
      .sort((a, b) => a.tabId - b.tabId);
    const fingerprints = tabs.map(tab => tab.lastReplyFingerprint).filter(Boolean);
    const allSameReply = tabs.length > 1
      && fingerprints.length === tabs.length
      && fingerprints.every(value => value === fingerprints[0]);
    const summary = Object.freeze({
      total: tabs.length,
      active: tabs.filter(tab => !tab.paused).length,
      paused: tabs.filter(tab => tab.paused).length,
      rateLimited: tabs.filter(tab => tab.rateLimitedSince > 0).length,
      stalled: tabs.filter(tab => tab.stalled).length,
      allSameReply
    });
    return Object.freeze({ thresholdMinutes: threshold, tabs, summary });
  }

  function createTabHealthController({
    storage,
    now = Date.now,
    setBadge = async () => undefined,
    listTabIds = async () => null
  } = {}) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function'
        || typeof now !== 'function') {
      throw new TypeError('Tab health controller dependencies are required');
    }
    let queue = Promise.resolve();

    function serial(operation) {
      const run = queue.then(operation, operation);
      queue = run.then(() => undefined, () => undefined);
      return run;
    }

    async function context() {
      const values = await storage.get({
        [TAB_HEALTH_STATE_KEY]: {},
        [TAB_HEALTH_LOG_KEY]: [],
        [TAB_HEALTH_THRESHOLD_KEY]: TAB_HEALTH_DEFAULT_MINUTES,
        accountBudgetAccountAlias: budget.DEFAULT_ACCOUNT_ALIAS
      });
      return {
        state: normalizeTabHealthState(values[TAB_HEALTH_STATE_KEY]),
        log: Array.isArray(values[TAB_HEALTH_LOG_KEY]) ? values[TAB_HEALTH_LOG_KEY] : [],
        thresholdMinutes: Math.max(1, Math.min(
          1440, Number(values[TAB_HEALTH_THRESHOLD_KEY]) || TAB_HEALTH_DEFAULT_MINUTES
        )),
        accountAlias: safeTabAlias(values.accountBudgetAccountAlias)
      };
    }

    async function snapshotFor(current) {
      const tabIds = await listTabIds().catch(() => null);
      const snapshot = tabHealthSnapshot(current.state, {
        now: now(),
        thresholdMinutes: current.thresholdMinutes,
        tabIds
      });
      await setBadge(snapshot.summary.stalled > 0
        ? String(Math.min(99, snapshot.summary.stalled)) : '').catch(() => undefined);
      return snapshot;
    }

    return Object.freeze({
      record(event) {
        return serial(async () => {
          const current = await context();
          const at = Math.max(1, Number(event?.at) || now());
          const normalizedEvent = {
            ...event,
            at,
            accountAlias: current.accountAlias
          };
          current.state = recordTabEvent(current.state, normalizedEvent);
          current.log = appendTabHealthLog(current.log, normalizedEvent);
          await storage.set({
            [TAB_HEALTH_STATE_KEY]: current.state,
            [TAB_HEALTH_LOG_KEY]: current.log
          });
          return snapshotFor(current);
        });
      },
      status() {
        return serial(async () => snapshotFor(await context()));
      }
    });
  }

  function listChatTabIds(extensionApi) {
    return new Promise((resolve, reject) => {
      try {
        const callback = tabs => resolve((Array.isArray(tabs) ? tabs : [])
          .map(tab => safeTabId(tab?.id)).filter(value => value !== null));
        const result = extensionApi?.tabs?.query?.({ url: ['https://chatgpt.com/*'] }, callback);
        if (typeof result?.then === 'function') void result.then(callback, reject);
        else if (!extensionApi?.tabs?.query) resolve(null);
      } catch (error) {
        reject(error);
      }
    });
  }

  function setActionBadge(extensionApi, text) {
    return new Promise((resolve, reject) => {
      try {
        if (!extensionApi?.action?.setBadgeText) {
          resolve();
          return;
        }
        const done = () => resolve();
        const result = extensionApi.action.setBadgeText({ text: String(text || '') }, done);
        if (typeof result?.then === 'function') void result.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  function install(extensionApi, now = Date.now) {
    if (!extensionApi?.runtime?.onMessage?.addListener) {
      throw new TypeError('Account budget runtime unavailable');
    }
    const storage = browserStorage(extensionApi);
    const controller = createController({ storage, now });
    const tabHealth = createTabHealthController({
      storage,
      now,
      setBadge: text => setActionBadge(extensionApi, text),
      listTabIds: () => listChatTabIds(extensionApi)
    });
    extensionApi.runtime.onMessage.addListener((message, sender, reply) => {
      const tabId = safeTabId(sender?.tab?.id);
      let operation = null;
      if (message?.type === 'autopilot:budget-status') {
        operation = controller.status();
      } else if (message?.type === 'autopilot:budget-consume') {
        operation = controller.consume({ reasoningLevel: message.reasoningLevel });
      } else if (message?.type === 'autopilot:budget-limit') {
        operation = controller.recordLimit({
          reasoningLevel: message.reasoningLevel,
          resetAt: Number.isSafeInteger(message.resetAt) && message.resetAt > 0
            ? message.resetAt : null
        }).then(async result => {
          if (tabId !== null) {
            await tabHealth.record({ tabId, type: 'rate-limit' });
          }
          return result;
        });
      } else if (message?.type === 'autopilot:tab-health-status') {
        operation = tabHealth.status().then(snapshot => ({ snapshot }));
      } else if (message?.type === 'autopilot:log' && tabId !== null) {
        if (message.event === 'send-confirmed') {
          void tabHealth.record({ tabId, type: 'send' });
        } else if (message.event === 'enabled-change'
            && typeof message.details?.enabled === 'boolean') {
          void tabHealth.record({
            tabId, type: 'enabled', enabled: message.details.enabled
          });
        }
        return undefined;
      } else if (message?.type === 'autopilot:learning-event'
          && message.event === 'cycle' && tabId !== null) {
        void tabHealth.record({
          tabId,
          type: 'reply',
          fingerprint: safeTabFingerprint(message.detail?.replyFingerprint)
        });
        return undefined;
      }
      if (operation === null) return undefined;
      void operation.then(
        result => reply({ ok: true, ...result }),
        () => reply({ ok: false })
      );
      return true;
    });
    void controller.status().then(() => undefined, () => undefined);
    void tabHealth.status().then(() => undefined, () => undefined);
    return controller;
  }

  return Object.freeze({
    SETTINGS,
    TAB_HEALTH_STATE_KEY,
    TAB_HEALTH_LOG_KEY,
    TAB_HEALTH_THRESHOLD_KEY,
    TAB_HEALTH_DEFAULT_MINUTES,
    TAB_HEALTH_MAX_LOG,
    createController,
    browserStorage,
    normalizeTabHealthState,
    recordTabEvent,
    appendTabHealthLog,
    tabHealthSnapshot,
    createTabHealthController,
    install
  });
