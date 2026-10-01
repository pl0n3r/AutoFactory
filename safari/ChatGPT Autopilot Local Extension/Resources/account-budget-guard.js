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
  let enabled = null;
  let ready = false;
  let snapshot = null;
  let reasoningLevel = 'unknown';
  let authorizationInFlight = false;
  let authorizedButton = null;
  let authorizedAt = 0;
  let refreshInFlight = false;
  let limitActive = false;

  function runtimeMessage(payload) {
    return new Promise((resolve, reject) => {
      try {
        const result = extensionApi.runtime.sendMessage(payload, response => {
          const error = extensionApi.runtime.lastError;
          if (error || !response) reject(new Error('budget-runtime-unavailable'));
          else resolve(response);
        });
        if (typeof result?.then === 'function') result.then(resolve, reject);
      } catch (error) { reject(error); }
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
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const response = await runtimeMessage({ type: 'autopilot:budget-status' });
      if (!response?.ok || !applySnapshot(response.snapshot)) ready = false;
    } catch (_error) {
      // Runtime failures are intentionally reduced to a fail-closed local state;
      // raw extension/provider errors are never persisted or logged here.
      ready = false;
    } finally {
      refreshInFlight = false;
    }
  }

  function budgetReadyNow() {
    if (enabled !== true || !ready || !snapshot) return false;
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
            !response.allowed || enabled !== true) return;
        if (core.sendButton(document) !== button || !originalCanSend(button)) return;
        authorizedButton = button;
        authorizedAt = Date.now();
      })
      .catch(() => { ready = false; })
      .finally(() => { authorizationInFlight = false; });
  }

  core.canSend = button => {
    if (!originalCanSend(button)) return false;
    if (enabled === false) return true;
    if (enabled !== true) return false;
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
        }).catch(() => { ready = false; });
      }
    } else {
      limitActive = false;
    }
    return signal;
  };

  clickPrototype.click = function (...args) {
    const sendButton = core.sendButton(document);
    if (this !== sendButton || enabled === false) return originalClick.apply(this, args);
    if (enabled !== true || !authorizationValid(this)) return undefined;
    clearAuthorization();
    return originalClick.apply(this, args);
  };

  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.masterEnabled) {
      enabled = Boolean(changes.masterEnabled.newValue);
      if (!enabled) clearAuthorization();
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
    reasoningLevel: 'high',
    accountBudgetSnapshotV1: null
  }, values => {
    enabled = Boolean(values.masterEnabled);
    reasoningLevel = values.reasoningLevel === 'high' ? 'high' : 'unknown';
    if (!applySnapshot(values.accountBudgetSnapshotV1)) void refreshStatus();
  });

  setInterval(() => {
    if (enabled === true) void refreshStatus();
  }, 5000);
})();
