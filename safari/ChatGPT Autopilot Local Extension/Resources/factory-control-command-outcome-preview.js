(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoFactoryCommandOutcomePreview = api;
  if (typeof document !== 'undefined') api.render(document);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Only static local examples. This module is never connected to a real command.
  const FIXTURE_NOW = 1_800_000_000_000;
  const MAX_AGE_MS = 60_000;
  const FIELDS = Object.freeze(['scope', 'code', 'observedAt', 'sequence']);
  // These are the existing *offline* replay simulator's result codes.
  const STATUS = Object.freeze({
    ok: Object.freeze({ state: 'OK', description: 'Éxito ficticio' }),
    failed: Object.freeze({ state: 'FAILED', description: 'Error ficticio' }),
    timeout: Object.freeze({ state: 'TIMEOUT', description: 'Respuesta tardía ficticia' }),
    already_handled: Object.freeze({ state: 'DUPLICATE', description: 'Orden repetida ficticia' }),
    unauthorized: Object.freeze({ state: 'REJECTED', description: 'Orden rechazada ficticia' })
  });
  const UNKNOWN = Object.freeze({ state: 'UNKNOWN', label: 'UNKNOWN · SIMULACIÓN · OFF' });

  function safeTime(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
  }

  function evaluate(fixture, nowMs = FIXTURE_NOW, previousSequence = 0) {
    if (!safeTime(nowMs) || !Number.isSafeInteger(previousSequence) ||
        previousSequence < 0 || !fixture || typeof fixture !== 'object' ||
        Array.isArray(fixture) || Reflect.ownKeys(fixture).length !== FIELDS.length ||
        !FIELDS.every(key => Object.hasOwn(fixture, key) &&
          Object.prototype.propertyIsEnumerable.call(fixture, key)) ||
        Reflect.ownKeys(fixture).some(key => typeof key !== 'string' || !FIELDS.includes(key))) {
      return UNKNOWN;
    }
    if (fixture.scope !== 'synthetic-only' ||
        typeof fixture.code !== 'string' || !Object.hasOwn(STATUS, fixture.code) ||
        !safeTime(fixture.observedAt) || fixture.observedAt > nowMs ||
        nowMs - fixture.observedAt > MAX_AGE_MS ||
        !Number.isSafeInteger(fixture.sequence) || fixture.sequence <= previousSequence ||
        fixture.sequence > 1_000_000) return UNKNOWN;
    const status = STATUS[fixture.code];
    return Object.freeze({
      state: status.state,
      label: status.description + ' · SIMULACIÓN · OFF'
    });
  }

  const examples = Object.freeze({
    ok: Object.freeze({ scope: 'synthetic-only', code: 'ok', observedAt: FIXTURE_NOW - 1000, sequence: 1 }),
    failed: Object.freeze({ scope: 'synthetic-only', code: 'failed', observedAt: FIXTURE_NOW - 2000, sequence: 2 }),
    timeout: Object.freeze({ scope: 'synthetic-only', code: 'timeout', observedAt: FIXTURE_NOW - 3000, sequence: 3 }),
    duplicate: Object.freeze({ scope: 'synthetic-only', code: 'already_handled', observedAt: FIXTURE_NOW - 4000, sequence: 4 }),
    rejected: Object.freeze({ scope: 'synthetic-only', code: 'unauthorized', observedAt: FIXTURE_NOW - 5000, sequence: 5 }),
    unknown: null
  });

  function render(doc) {
    if (!doc || typeof doc.getElementById !== 'function') return;
    for (const [name, fixture] of Object.entries(examples)) {
      const element = doc.getElementById('command-outcome-preview-' + name);
      if (element) element.textContent = evaluate(fixture).label;
    }
  }

  return Object.freeze({ evaluate, render });
});
