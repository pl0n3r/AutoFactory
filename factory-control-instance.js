(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryInstance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATE_VERSION = 1;
  const PROTOCOL_VERSION = 2;
  const MAX_GRANT_MS = 24 * 60 * 60 * 1000;
  const BROWSERS = new Set(['chrome', 'safari']);
  const ACTIONS = new Set(['pause', 'resume']);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
  const VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

  function exact(value, fields, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new TypeError('Invalid ' + label);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length ||
        keys.some(key => typeof key !== 'string' || !fields.includes(key))) {
      throw new TypeError('Invalid ' + label);
    }
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !descriptor.enumerable ||
          typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
        throw new TypeError('Invalid ' + label);
      }
    }
    return value;
  }

  function alias(value, label) {
    if (typeof value !== 'string' || value.trim() !== value ||
        value.length < 1 || value.length > 64 || /[@\r\n\x00-\x1f]/.test(value) ||
        !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(value)) {
      throw new TypeError('Invalid ' + label);
    }
    return value;
  }

  function clock(now) {
    let value;
    try { value = now(); } catch (_error) { throw new Error('Instance clock unavailable'); }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Instance clock unavailable');
    }
    return value;
  }

  function checkedGrant(value, nowMs) {
    if (value === null) return null;
    exact(value, ['id', 'actions', 'expiresAt', 'revoked'], 'instance grant');
    if (typeof value.id !== 'string' || !ID.test(value.id) ||
        !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 1 ||
        typeof value.revoked !== 'boolean' ||
        !Array.isArray(value.actions) || value.actions.length < 1 ||
        value.actions.length > ACTIONS.size) {
      throw new TypeError('Invalid instance grant');
    }
    const seen = new Set();
    const actions = [];
    for (let index = 0; index < value.actions.length; index++) {
      const action = value.actions[index];
      if (!Object.hasOwn(value.actions, index) || !ACTIONS.has(action) || seen.has(action)) {
        throw new TypeError('Invalid instance grant');
      }
      seen.add(action);
      actions.push(action);
    }
    if (!value.revoked &&
        (value.expiresAt <= nowMs || value.expiresAt > nowMs + MAX_GRANT_MS)) {
      throw new TypeError('Invalid instance grant');
    }
    return { id: value.id, actions, expiresAt: value.expiresAt, revoked: value.revoked };
  }

  function createInstanceStore({
    storage,
    uuid,
    now = Date.now,
    browser,
    extensionVersion
  } = {}) {
    if (!storage || typeof storage.get !== 'function' ||
        typeof storage.set !== 'function' || typeof storage.remove !== 'function' ||
        typeof uuid !== 'function' || typeof now !== 'function' ||
        !BROWSERS.has(browser) || typeof extensionVersion !== 'string' ||
        !VERSION.test(extensionVersion)) {
      throw new TypeError('Instance store dependencies are required');
    }

    const key = 'factoryControlInstanceV2:' + browser;

    async function request(method, ...args) {
      try {
        return await storage[method](...args);
      } catch (_error) {
        throw new Error('Instance storage unavailable');
      }
    }

    function checkedState(value) {
      if (value === null || value === undefined) return null;
      exact(value, [
        'version', 'instanceId', 'browser', 'profileAlias', 'deviceAlias',
        'extensionVersion', 'protocolVersion', 'grant'
      ], 'instance state');
      if (value.version !== STATE_VERSION || value.browser !== browser ||
          value.protocolVersion !== PROTOCOL_VERSION ||
          typeof value.instanceId !== 'string' || !UUID.test(value.instanceId) ||
          typeof value.extensionVersion !== 'string' || !VERSION.test(value.extensionVersion)) {
        throw new TypeError('Invalid instance state');
      }
      return {
        version: STATE_VERSION,
        instanceId: value.instanceId,
        browser,
        profileAlias: alias(value.profileAlias, 'profile alias'),
        deviceAlias: alias(value.deviceAlias, 'device alias'),
        extensionVersion: value.extensionVersion,
        protocolVersion: PROTOCOL_VERSION,
        grant: checkedGrant(value.grant, clock(now))
      };
    }

    async function load() {
      return checkedState(await request('get', key));
    }

    async function save(state) {
      await request('set', key, checkedState(state));
    }

    async function create(profileAlias, deviceAlias) {
      const profile = alias(profileAlias, 'profile alias');
      const device = alias(deviceAlias, 'device alias');
      const existing = await load();
      if (existing) {
        if (existing.profileAlias !== profile || existing.deviceAlias !== device) {
          throw new TypeError('Instance identity is immutable');
        }
        return Object.freeze(existing);
      }
      let instanceId;
      try { instanceId = uuid(); } catch (_error) {
        throw new Error('Instance UUID unavailable');
      }
      if (typeof instanceId !== 'string' || !UUID.test(instanceId)) {
        throw new TypeError('Invalid instance UUID');
      }
      const state = {
        version: STATE_VERSION,
        instanceId,
        browser,
        profileAlias: profile,
        deviceAlias: device,
        extensionVersion,
        protocolVersion: PROTOCOL_VERSION,
        grant: null
      };
      await save(state);
      return Object.freeze(state);
    }

    async function grant(record) {
      exact(record, ['id', 'actions', 'expiresAt'], 'grant request');
      const state = await load();
      if (!state) throw new TypeError('Instance identity is required');
      const nextGrant = checkedGrant({
        id: record.id,
        actions: record.actions,
        expiresAt: record.expiresAt,
        revoked: false
      }, clock(now));
      const next = { ...state, extensionVersion, grant: nextGrant };
      await save(next);
      return Object.freeze(nextGrant);
    }

    async function revoke() {
      const state = await load();
      if (!state) throw new TypeError('Instance identity is required');
      if (!state.grant || state.grant.revoked) return false;
      const next = { ...state, extensionVersion, grant: { ...state.grant, revoked: true } };
      await save(next);
      return true;
    }

    async function safeSnapshot() {
      const state = await load();
      if (!state) return null;
      return Object.freeze({
        instanceId: state.instanceId,
        browser: state.browser,
        profileAlias: state.profileAlias,
        deviceAlias: state.deviceAlias,
        extensionVersion,
        protocolVersion: state.protocolVersion
      });
    }

    return Object.freeze({ load, create, grant, revoke, safeSnapshot });
  }

  return Object.freeze({
    STATE_VERSION,
    PROTOCOL_VERSION,
    MAX_GRANT_MS,
    createInstanceStore
  });
});
