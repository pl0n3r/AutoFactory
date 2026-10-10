(function () {
  'use strict';
  const core = globalThis.ChatGPTAutopilotCore;
  const extensionApi = globalThis.chrome || globalThis.browser;
  if (!core || !extensionApi?.runtime || !extensionApi?.storage?.local) return;

  const originalCanSend = core.canSend.bind(core);
  const originalPageSignal = core.pageSignal.bind(core);
  const clickPrototype = globalThis.HTMLElement?.prototype;
  const originalClick = clickPrototype?.click;
  if (typeof originalClick !== 'function') return;

  const AUTHORIZATION_TTL_MS = 5000;
  const WAIT_POLL_MS = 250;
  const UNAVAILABLE_WAIT_MS = 8000;
  const SNAPSHOT_RESPONSE_TIMEOUT_MS = 2000;
  const BUDGET_UNAVAILABLE = Object.freeze({ ok: false, reason: 'budget_unavailable' });
  let masterEnabled = null;
  let budgetEnabled = null;
  let ready = false;
  let snapshot = null;
  let reasoningLevel = 'unknown';
  let authorizationInFlight = false;
  let authorizedButton = null;
  let authorizedAt = 0;
  let refreshInFlight = null;
  let limitActive = false;

  function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function runtimeMessage(payload) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId;
      const settle = (response, unavailable = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (unavailable || !response) reject(new Error('budget-runtime-unavailable'));
        else resolve(response);
      };
      try {
        const result = extensionApi.runtime.sendMessage(payload, response => {
          settle(response, Boolean(extensionApi.runtime.lastError));
        });
        if (typeof result?.then === 'function') {
          void result.then(response => settle(response), () => settle(null, true));
        }
        if (!settled) {
          timeoutId = setTimeout(() => settle(null, true), SNAPSHOT_RESPONSE_TIMEOUT_MS);
        }
      } catch (_error) {
        settle(null, true);
      }
    });
  }

  function applySnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const numeric = ['windowMs', 'budget', 'sent', 'remaining', 'limitEvents', 'highReasoningSends'];
    if (!numeric.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)) return false;
    if (value.nextAllowedAt !== null &&
        (!Number.isSafeInteger(value.nextAllowedAt) || value.nextAllowedAt < 0)) return false;
    if (!['default', 'factory'].includes(value.source)) return false;
    snapshot = Object.freeze({ ...value });
    ready = true;
    return true;
  }

  function clearAuthorization() {
    authorizedButton = null;
    authorizedAt = 0;
  }

  function authorizationValid(button) {
    if (authorizedButton !== button) return false;
    if (Date.now() - authorizedAt > AUTHORIZATION_TTL_MS) {
      clearAuthorization();
      return false;
    }
    return true;
  }

  async function refreshStatus() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = runtimeMessage({ type: 'autopilot:budget-status' })
      .then(response => {
        if (!response?.ok || !applySnapshot(response.snapshot)) {
          ready = false;
          return false;
        }
        return true;
      }, () => {
        ready = false;
        return false;
      })
      .finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  function nextAllowedAt() {
    return ready && snapshot ? snapshot.nextAllowedAt : null;
  }

  async function ensureSnapshot() {
    if (masterEnabled === true && budgetEnabled === true && ready && snapshot) return true;
    return refreshStatus();
  }

  function waitDelayMs() {
    const current = Date.now();
    if (snapshot?.nextAllowedAt !== null && snapshot.nextAllowedAt > current) {
      return Math.min(1000, Math.max(50, snapshot.nextAllowedAt - current));
    }
    return WAIT_POLL_MS;
  }

  async function waitBudgetReadyStep() {
    let unavailableSince = Date.now();
    for (;;) {
      if (budgetEnabled === false) return true;
      if (masterEnabled === false) return false;
      let timeoutId;
      let refreshed;
      try {
        refreshed = await Promise.race([
          ensureSnapshot(),
          new Promise(resolve => {
            timeoutId = setTimeout(() => resolve(false), SNAPSHOT_RESPONSE_TIMEOUT_MS);
          })
        ]);
      } finally {
        clearTimeout(timeoutId);
      }
      if (budgetEnabled === false) return true;
      if (masterEnabled === false) return false;
      if (!refreshed || masterEnabled !== true || budgetEnabled !== true) {
        const elapsed = Date.now() - unavailableSince;
        if (!Number.isFinite(elapsed) || elapsed >= UNAVAILABLE_WAIT_MS) {
          return BUDGET_UNAVAILABLE;
        }
        await delay(Math.min(WAIT_POLL_MS, UNAVAILABLE_WAIT_MS - elapsed));
        continue;
      }
      unavailableSince = Date.now();
      if (snapshot.nextAllowedAt === null && snapshot.remaining > 0) return true;
      await delay(waitDelayMs());
      if (snapshot?.nextAllowedAt !== null && Date.now() >= snapshot.nextAllowedAt) {
        ready = false;
      }
    }
  }

  function waitUntilReady() {
    return waitBudgetReadyStep();
  }

  function budgetReadyNow() {
    if (budgetEnabled === false) return true;
    if (masterEnabled !== true || !ready || !snapshot) return false;
    if (snapshot.nextAllowedAt !== null) {
      if (Date.now() < snapshot.nextAllowedAt) return false;
      ready = false;
      void refreshStatus();
      return false;
    }
    if (snapshot.remaining <= 0) {
      ready = false;
      void refreshStatus();
      return false;
    }
    return true;
  }

  function requestAuthorization(button) {
    if (authorizationInFlight || !budgetReadyNow()) return;
    authorizationInFlight = true;
    ready = false;
    void runtimeMessage({ type: 'autopilot:budget-consume', reasoningLevel })
      .then(response => {
        if (!response?.ok || !applySnapshot(response.snapshot) ||
            !response.allowed || masterEnabled !== true || budgetEnabled !== true) return;
        if (core.sendButton(document) !== button || !originalCanSend(button)) return;
        authorizedButton = button;
        authorizedAt = Date.now();
      }, () => { ready = false; })
      .finally(() => { authorizationInFlight = false; });
  }

  core.canSend = button => {
    if (!originalCanSend(button)) return false;
    if (budgetEnabled === false || masterEnabled === false) return true;
    if (masterEnabled !== true || budgetEnabled !== true) return false;
    if (authorizationValid(button)) return true;
    requestAuthorization(button);
    return false;
  };

  core.pageSignal = doc => {
    const signal = originalPageSignal(doc);
    if (signal?.code === 'rate-limit') {
      if (!limitActive) {
        limitActive = true;
        clearAuthorization();
        void runtimeMessage({
          type: 'autopilot:budget-limit',
          reasoningLevel,
          resetAt: null
        }).then(response => {
          if (response?.ok) applySnapshot(response.snapshot);
        }, () => { ready = false; });
      }
    } else {
      limitActive = false;
    }
    return signal;
  };

  clickPrototype.click = function (...args) {
    const sendButton = core.sendButton(document);
    if (this !== sendButton || budgetEnabled === false || masterEnabled === false) {
      return originalClick.apply(this, args);
    }
    if (masterEnabled !== true || budgetEnabled !== true || !authorizationValid(this)) return undefined;
    clearAuthorization();
    return originalClick.apply(this, args);
  };

  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.masterEnabled) {
      masterEnabled = Boolean(changes.masterEnabled.newValue);
      if (!masterEnabled) clearAuthorization();
    }
    if (changes.accountBudgetEnabled) {
      budgetEnabled = changes.accountBudgetEnabled.newValue === true;
      clearAuthorization();
      ready = false;
      if (budgetEnabled) void refreshStatus();
    }
    if (changes.reasoningLevel) {
      reasoningLevel = changes.reasoningLevel.newValue === 'high' ? 'high' : 'unknown';
    }
    if (changes.accountBudgetSnapshotV1?.newValue) {
      applySnapshot(changes.accountBudgetSnapshotV1.newValue);
    }
    if (changes.accountBudgetLimit || changes.accountBudgetWindowMinutes ||
        changes.accountBudgetAccountAlias || changes.factoryAccountBudgetV1) {
      clearAuthorization();
      ready = false;
      void refreshStatus();
    }
  });

  extensionApi.storage.local.get({
    masterEnabled: false,
    accountBudgetEnabled: false,
    reasoningLevel: 'high',
    accountBudgetSnapshotV1: null
  }, values => {
    masterEnabled = Boolean(values.masterEnabled);
    budgetEnabled = values.accountBudgetEnabled === true;
    reasoningLevel = values.reasoningLevel === 'high' ? 'high' : 'unknown';
    if (budgetEnabled && !applySnapshot(values.accountBudgetSnapshotV1)) void refreshStatus();
  });

  globalThis.ChatGPTAutopilotBudgetGuard = Object.freeze({
    waitUntilReady,
    nextAllowedAt
  });

  setInterval(() => {
    if (masterEnabled === true && budgetEnabled === true) void refreshStatus();
  }, 5000);
})();
