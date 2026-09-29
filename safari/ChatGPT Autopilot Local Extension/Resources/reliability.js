(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotReliability = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SESSION_KEY = 'chatgpt-autopilot-runtime-v1';
  const MAX_FAILURES = 5;
  const MAX_RELOADS = 3;
  const DEFAULT_PLATFORM_REVIEW_MAX_MS = 180000;

  function signature(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${text.length}:${(hash >>> 0).toString(16)}`;
  }
  function normalize(value = {}) {
    return {
      pendingSignature: String(value.pendingSignature || ''),
      assistantCountBeforeSend: Math.max(0, Number(value.assistantCountBeforeSend) || 0),
      lastSentAt: Math.max(0, Number(value.lastSentAt) || 0),
      consecutiveFailures: Math.max(0, Number(value.consecutiveFailures) || 0),
      circuitOpenUntil: Math.max(0, Number(value.circuitOpenUntil) || 0),
      reloadAttempts: Math.max(0, Number(value.reloadAttempts) || 0),
      reloadWindowStartedAt: Math.max(0, Number(value.reloadWindowStartedAt) || 0)
    };
  }
  function load(storage) {
    try { return normalize(JSON.parse(storage.getItem(SESSION_KEY) || '{}')); }
    catch (_error) { return normalize(); }
  }
  function save(storage, value) {
    const normalized = normalize(value);
    storage.setItem(SESSION_KEY, JSON.stringify(normalized));
    return normalized;
  }
  function backoffMs(failures) {
    return Math.min(300000, 5000 * Math.pow(2, Math.max(0, Number(failures) - 1)));
  }
  function afterFailure(value, now = Date.now()) {
    const next = normalize(value);
    next.consecutiveFailures += 1;
    if (next.consecutiveFailures >= MAX_FAILURES) next.circuitOpenUntil = now + 300000;
    return { ...next, retryAt: now + backoffMs(next.consecutiveFailures) };
  }
  function sendAccepted({ composerCleared, messageAppeared, generationStarted } = {}) {
    return composerCleared === true && (messageAppeared === true || generationStarted === true);
  }
  function afterSuccess(value) {
    return { ...normalize(value), consecutiveFailures: 0, circuitOpenUntil: 0 };
  }
  function beforeReload(value, now = Date.now()) {
    const next = normalize(value);
    if (!next.reloadWindowStartedAt || now - next.reloadWindowStartedAt > 600000) {
      next.reloadWindowStartedAt = now;
      next.reloadAttempts = 0;
    }
    next.reloadAttempts += 1;
    if (next.reloadAttempts > MAX_RELOADS) next.circuitOpenUntil = now + 600000;
    return next;
  }
  function canReload(value, now = Date.now()) {
    const current = normalize(value);
    return now >= current.circuitOpenUntil && (
      !current.reloadWindowStartedAt || now - current.reloadWindowStartedAt > 600000
      || current.reloadAttempts < MAX_RELOADS
    );
  }
  function platformReviewProgress(
    value = {}, now = Date.now(), maxMs = DEFAULT_PLATFORM_REVIEW_MAX_MS, visible = true
  ) {
    const normalizedNow = Math.max(0, Number(now) || 0);
    const normalizedMaxMs = Math.max(1000, Number(maxMs) || DEFAULT_PLATFORM_REVIEW_MAX_MS);
    const previousStartedAt = Math.max(0, Number(value.startedAt) || 0);
    if (!visible) {
      return Object.freeze({
        startedAt: 0,
        elapsedMs: 0,
        timedOut: false,
        shouldEscalate: false,
        escalated: false,
        action: previousStartedAt ? 'resume' : 'none'
      });
    }
    const startedAt = previousStartedAt || normalizedNow;
    const elapsedMs = Math.max(0, normalizedNow - startedAt);
    const timedOut = elapsedMs >= normalizedMaxMs;
    const wasEscalated = value.escalated === true;
    const shouldEscalate = timedOut && !wasEscalated;
    return Object.freeze({
      startedAt,
      elapsedMs,
      timedOut,
      shouldEscalate,
      escalated: wasEscalated || shouldEscalate,
      action: shouldEscalate ? 'escalate' : timedOut ? 'hold' : 'wait'
    });
  }
  return {
    SESSION_KEY, MAX_FAILURES, MAX_RELOADS, DEFAULT_PLATFORM_REVIEW_MAX_MS,
    signature, normalize, load, save, backoffMs, sendAccepted, afterFailure,
    afterSuccess, beforeReload, canReload, platformReviewProgress
  };
});
