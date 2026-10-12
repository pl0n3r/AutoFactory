/* Factory #173: offline two-phase admission guard; NOT a send authorization. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotKeepaliveAdmission = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SHAPE = Object.freeze({
    chat: ['last_prompt_s', 'last_reply_s', 'last_activity_s', 'last_reply_chars',
      'msgs_hour', 'state', 'reservation_active', 'reply_complete', 'identical_read_count'],
    account: ['msgs_hour', 'observed_limit_hour', 'usage_limited'],
    controls: ['enabled', 'manual_pause', 'kill_switch_running', 'circuit_breaker_open',
      'ambiguous_send', 'session_closed', 'min_pacing_s'],
    history: ['retries_s']
  });
  const GATE_KEYS = ['revision', 'enabled', 'reservation_valid', 'same_chat',
    'account_open', 'lease_epoch', 'account_epoch', 'ui_epoch', 'snapshot'];
  const REQUIRED_GATE = GATE_KEYS;
  const deny = reason => Object.freeze({ status: 'denied', reason });
  const ELIGIBLE = Object.freeze({ status: 'eligible', reason: 'offline_candidate' });

  function isPlain(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  function safeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }
  // Never invoke property accessors or copy unknown keys, account identifiers,
  // prompts, credentials or arbitrary application objects into snapshots/results.
  function copyRecord(value, permitted, required) {
    if (!isPlain(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Reflect.ownKeys(descriptors);
    if (names.some(name => typeof name !== 'string' || !permitted.includes(name))) return null;
    if (required.some(name => !Object.hasOwn(descriptors, name))) return null;
    const result = Object.create(null);
    for (const name of permitted) {
      if (!Object.hasOwn(descriptors, name)) continue;
      const d = descriptors[name];
      if (!Object.hasOwn(d, 'value')) return null;
      result[name] = d.value;
    }
    return result;
  }
  function copySnapshot(value) {
    const outer = copyRecord(value, Object.keys(SHAPE), Object.keys(SHAPE));
    if (!outer) return null;
    const result = Object.create(null);
    for (const [name, fields] of Object.entries(SHAPE)) {
      const required = name === 'controls' ? fields.filter(k => k !== 'min_pacing_s') : fields;
      const item = copyRecord(outer[name], fields, required);
      if (!item) return null;
      for (const [field, val] of Object.entries(item)) {
        if (name === 'history' && field === 'retries_s') {
          if (!Array.isArray(val) || val.length > 100 ||
              Object.keys(val).length !== val.length || !val.every(safeInteger)) return null;
          item[field] = [...val];
        } else if (field === 'state') {
          if (!['activo', 'inactivo', 'cerrado'].includes(val)) return null;
        } else if (['reservation_active', 'reply_complete', 'enabled', 'manual_pause',
          'kill_switch_running', 'circuit_breaker_open', 'ambiguous_send',
          'session_closed', 'usage_limited'].includes(field)) {
          if (typeof val !== 'boolean') return null;
        } else if (!(val === null && ['last_prompt_s', 'last_reply_s'].includes(field)) &&
                   !safeInteger(val)) return null;
      }
      result[name] = item;
    }
    return result;
  }
  function copyEvidence(value) {
    const data = copyRecord(value, GATE_KEYS, REQUIRED_GATE);
    if (!data || !safeInteger(data.revision) || data.enabled !== true ||
        data.reservation_valid !== true || data.same_chat !== true ||
        data.account_open !== true ||
        ![data.lease_epoch, data.account_epoch, data.ui_epoch].every(safeInteger)) return null;
    const snapshot = copySnapshot(data.snapshot);
    if (!snapshot) return null;
    // Stable canonical ordering, allowlisted primitives only, never a raw payload.
    const normalized = [data.revision, data.lease_epoch, data.account_epoch,
      data.ui_epoch, snapshot];
    return { snapshot, fingerprint: JSON.stringify(normalized) };
  }
  function policyAllows(policy, snapshot, at) {
    if (!policy || typeof policy.evaluate !== 'function' || !safeInteger(at)) return false;
    const decision = policy.evaluate(snapshot, at);
    if (!isPlain(decision)) return false;
    const action = Object.getOwnPropertyDescriptor(decision, 'action');
    return !!action && Object.hasOwn(action, 'value') && action.value === 'reenganchar';
  }

  function createAdmissionGuard({ policy, readEvidence, now } = {}) {
    if (typeof readEvidence !== 'function' || typeof now !== 'function' ||
        !policy || typeof policy.evaluate !== 'function') {
      throw new TypeError('Injected offline policy, evidence reader and clock are required');
    }
    // A terminal one-shot latch: even a failed/ambiguous attempt cannot be
    // retried inside the same guard instance. Future runtimes must implement a
    // distinct durable reservation and send-time revalidation (outside scope).
    let state = 'new';
    let collision = false;
    async function assess() {
      if (state !== 'new') {
        if (state === 'checking') collision = true;
        return deny(state === 'checking' ? 'concurrent' : 'latched');
      }
      state = 'checking';
      try {
        const first = copyEvidence(await readEvidence());
        if (!first || collision) return deny('invalid_evidence');
        const firstTime = now();
        if (!policyAllows(policy, first.snapshot, firstTime)) return deny('policy');
        const second = copyEvidence(await readEvidence());
        if (!second || collision) return deny('invalid_evidence');
        const secondTime = now();
        if (!safeInteger(secondTime) || firstTime !== secondTime ||
            first.fingerprint !== second.fingerprint || collision) return deny('stale');
        if (!policyAllows(policy, second.snapshot, secondTime) || collision) return deny('policy');
        return ELIGIBLE;
      } catch (_error) {
        return deny('invalid_evidence');
      } finally {
        state = 'closed';
      }
    }
    return Object.freeze({ assess });
  }

  return Object.freeze({ createAdmissionGuard });
});
