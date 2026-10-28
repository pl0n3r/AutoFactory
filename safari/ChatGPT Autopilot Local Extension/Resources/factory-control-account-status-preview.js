(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoFactoryAccountStatusPreview = api;
  if (typeof document !== 'undefined') api.render(document);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FRESH_MS = 60_000;
  const MAX_RESET_MS = 7 * 24 * 60 * 60 * 1000;
  const UNKNOWN = Object.freeze({ code: 'UNKNOWN', freshness: 'sin evidencia', resetAt: null });
  const FIELDS = 'kind,observedAt,resetAt,validUntil';

  function evaluate(fixture, nowMs) {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !fixture ||
        typeof fixture !== 'object' || Array.isArray(fixture) ||
        Object.keys(fixture).sort((left, right) => left.localeCompare(right)).join(',') !== FIELDS) return UNKNOWN;
    const { kind, observedAt, validUntil, resetAt } = fixture;
    if (kind !== 'limit' && kind !== 'requires_login') return UNKNOWN;
    if (!Number.isSafeInteger(observedAt) || observedAt < 0 || observedAt > nowMs ||
        nowMs - observedAt > FRESH_MS || !Number.isSafeInteger(validUntil) ||
        validUntil <= nowMs || validUntil > nowMs + FRESH_MS) return UNKNOWN;
    if (kind === 'requires_login' && resetAt !== null) return UNKNOWN;
    if (kind === 'limit' && (!Number.isSafeInteger(resetAt) ||
        resetAt <= nowMs || resetAt > nowMs + MAX_RESET_MS)) return UNKNOWN;
    return Object.freeze({
      code: kind === 'limit' ? 'LIMITADO' : 'REQUIERE_LOGIN',
      freshness: 'ejemplo fresco',
      resetAt: kind === 'limit' ? resetAt : null
    });
  }

  function syntheticExamples(nowMs) {
    return Object.freeze({
      limit: { kind: 'limit', observedAt: nowMs - 5_000,
        validUntil: nowMs + 20_000, resetAt: nowMs + 120_000 },
      login: { kind: 'requires_login', observedAt: nowMs - 5_000,
        validUntil: nowMs + 20_000, resetAt: null }
    });
  }

  function render(doc, clock = () => Date.now()) {
    if (!doc || typeof doc.getElementById !== 'function') return;
    const nowMs = clock();
    const examples = syntheticExamples(nowMs);
    const entries = [
      ['account-status-preview-limit', evaluate(examples.limit, nowMs)],
      ['account-status-preview-login', evaluate(examples.login, nowMs)],
      ['account-status-preview-unknown', evaluate(null, nowMs)]
    ];
    for (const [id, result] of entries) {
      const output = doc.getElementById(id);
      if (output) output.textContent = result.code + ' · ' + result.freshness + ' · SIMULACIÓN · OFF';
    }
  }

  return Object.freeze({ evaluate, render, syntheticExamples });
});
