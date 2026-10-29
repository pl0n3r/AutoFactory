(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoFactoryHeartbeatOfflinePreview = api;
  if (typeof document !== 'undefined') api.render(document);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FRESH_MS = 60_000;
  const OFFLINE_MS = 180_000;
  const UNKNOWN = Object.freeze({ state: 'UNKNOWN', ageSeconds: null, confirmedAt: null, reason: 'Sin evidencia simulada verificable' });
  const KEYS = ['lastConfirmedAt', 'missedIntervals', 'observedAt', 'scope', 'sequence', 'state'];

  function safeTime(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
  }

  function evaluate(fixture, nowMs, previousSequence = 0) {
    if (!safeTime(nowMs) || !Number.isSafeInteger(previousSequence) || previousSequence < 0 ||
        !fixture || typeof fixture !== 'object' || Array.isArray(fixture) ||
        Reflect.ownKeys(fixture).length !== KEYS.length ||
        !KEYS.every(key => Object.hasOwn(fixture, key) &&
          Object.prototype.propertyIsEnumerable.call(fixture, key)) ||
        Reflect.ownKeys(fixture).some(key => typeof key !== 'string' || !KEYS.includes(key))) return UNKNOWN;
    const { scope, state, observedAt, lastConfirmedAt, missedIntervals, sequence } = fixture;
    if (scope !== 'synthetic-only' || !['online', 'stale', 'offline'].includes(state) ||
        !safeTime(observedAt) || observedAt > nowMs || nowMs - observedAt > FRESH_MS ||
        !safeTime(lastConfirmedAt) || lastConfirmedAt > observedAt ||
        !Number.isSafeInteger(missedIntervals) || missedIntervals < 0 || missedIntervals > 32 ||
        !Number.isSafeInteger(sequence) || sequence <= previousSequence) return UNKNOWN;
    const ageMs = nowMs - lastConfirmedAt;
    if (state === 'online' && (ageMs > FRESH_MS || missedIntervals !== 0)) return UNKNOWN;
    if (state === 'stale' && (ageMs <= FRESH_MS || ageMs > OFFLINE_MS ||
        missedIntervals < 1 || missedIntervals > 2)) return UNKNOWN;
    if (state === 'offline' && (ageMs <= OFFLINE_MS || missedIntervals < 3)) return UNKNOWN;
    return Object.freeze({ state: state.toUpperCase(), ageSeconds: Math.floor(ageMs / 1000),
      confirmedAt: new Date(lastConfirmedAt).toISOString(),
      reason: state === 'online' ? 'Latido ficticio reciente' :
        state === 'stale' ? 'Latido ficticio atrasado' : 'Sin latido ficticio reciente' });
  }

  function examples(nowMs) {
    const stamp = safeTime(nowMs) && nowMs >= 240_000 ? nowMs : 240_000;
    const source = (state, age, misses, sequence) => ({
      scope: 'synthetic-only', state, observedAt: stamp, lastConfirmedAt: stamp - age,
      missedIntervals: misses, sequence
    });
    return Object.freeze({ online: source('online', 5_000, 0, 1),
      stale: source('stale', 90_000, 1, 2), offline: source('offline', 240_000, 3, 3) });
  }

  function render(doc, clock = () => Date.now()) {
    if (!doc || typeof doc.getElementById !== 'function') return;
    const nowMs = clock();
    const fixtures = examples(nowMs);
    for (const key of ['online', 'stale', 'offline', 'unknown']) {
      const output = doc.getElementById('heartbeat-offline-preview-' + key);
      if (!output) continue;
      const result = evaluate(key === 'unknown' ? null : fixtures[key], nowMs);
      output.textContent = result.state + ' · ' +
        (result.ageSeconds === null ? 'edad desconocida' : result.ageSeconds + ' s') +
        ' · ' + (result.confirmedAt || 'fecha desconocida') +
        ' · ' + result.reason + ' · SIMULACIÓN · OFF';
    }
  }

  return Object.freeze({ evaluate, examples, render, FRESH_MS, OFFLINE_MS });
});
