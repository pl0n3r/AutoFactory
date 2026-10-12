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
    'chats_open', 'limit_resets_at', 'idle_reason', 'idle_since']);
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
    if ((state === 'limite' || state === 'sesion_cerrada') &&
        iso(fields.limit_resets_at)) {
      payload.limit_resets_at = fields.limit_resets_at;
    }
    return Object.freeze(payload);
  }

  function createPublisher({ now, enabled, permission, snapshot, post } = {}) {
    if (![now, enabled, permission, snapshot, post].every(x => typeof x === 'function')) {
      throw new TypeError('publisher ports required');
    }
    let nextAllowed = 0;
    let failures = 0;
    let inFlight = false;
    async function publish() {
      if (inFlight) return false;
      inFlight = true;
      try {
        const current = now();
        if (!Number.isSafeInteger(current) || current < 0 ||
            current < nextAllowed || !(await enabled()) || !(await permission())) {
          return false;
        }
        const payload = payloadFrom(await snapshot());
        const result = await post(payload);
        if (result !== true) throw new TypeError('local receiver unavailable');
        failures = 0;
        nextAllowed = current + 30_000;
        return true;
      } catch (_error) {
        // No exception details, chat content or private transport data in logs.
        failures = Math.min(failures + 1, 5);
        try {
          nextAllowed = Math.max(nextAllowed,
            now() + Math.min(600_000, 30_000 * (2 ** failures)));
        } catch (_ignored) { nextAllowed = Number.MAX_SAFE_INTEGER; }
        return false;
      } finally {
        inFlight = false;
      }
    }
    return Object.freeze({ publish, payloadFrom });
  }

  // Browser worker integration is installed by background-entry.js after V3 renewal.
  return Object.freeze({ HOST, ENDPOINT, FLAG, INSTANCE, ALARM,
    STATES, REASONS, payloadFrom, createPublisher });
});
