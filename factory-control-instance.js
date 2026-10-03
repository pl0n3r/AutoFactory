(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./factory-control-protocol.js')
      : root.ChatGPTAutopilotFactoryProtocol
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryInstance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (protocol) {
  'use strict';

  const BROWSERS = new Set(['chrome', 'safari']);
  const GRANT_ACTIONS = new Set(['pause', 'resume']);
  const MAX_GRANT_TTL_MS = 86400000;

  function fail(message) {
    throw new TypeError(message);
  }

  function alias(value, label) {
    if (typeof value !== 'string' || value.trim() !== value || !value ||
        value.length > 64 || /[@\r\n\x00-\x1f]/.test(value)) {
      fail(label + ' must be a short alias, not an email or secret');
    }
    return value;
  }

  function version(value, label) {
    if (typeof value !== 'string' || value.length > 40 ||
        !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) {
      fail(label + ' is invalid');
    }
    return value;
  }

  function timestamp(value) {
    if (!Number.isSafeInteger(value) || value < 0) fail('Invalid instance timestamp');
    return value;
  }

  function denseActions(values) {
    if (!Array.isArray(values) || values.length < 1 ||
        values.length > GRANT_ACTIONS.size) {
      fail('Invalid instance grant actions');
    }
    const seen = new Set();
    const output = [];
    for (let index = 0; index < values.length; index++) {
      const action = values[index];
      if (!Object.hasOwn(values, index) || !GRANT_ACTIONS.has(action) || seen.has(action)) {
        fail('Invalid instance grant actions');
      }
      seen.add(action);
      output.push(action);
    }
    return output;
  }

  function createInstanceStore({
    storage,
    uuid,
    now,
    browser,
    extensionVersion,
    protocolVersion
  } = {}) {
    if (!protocol?.validationV2 ||
        !storage || typeof storage.get !== 'function' ||
        typeof storage.set !== 'function' || typeof storage.remove !== 'function' ||
        typeof uuid !== 'function' || typeof now !== 'function' ||
        !BROWSERS.has(browser) ||
        !Number.isSafeInteger(protocolVersion) ||
        protocolVersion !== protocol.VERSION_2) {
      fail('Instance store dependencies are invalid');
    }
    const currentExtensionVersion = version(extensionVersion, 'extensionVersion');
    const identityKey = 'factoryControlInstanceV2:' + browser + ':identity';
    const grantKey = 'factoryControlInstanceV2:' + browser + ':grant';

    async function read(key) {
      try {
        return await storage.get(key);
      } catch (_error) {
        throw new Error('Instance storage unavailable');
      }
    }

    async function write(key, value) {
      try {
        await storage.set(key, value);
      } catch (_error) {
        throw new Error('Instance storage unavailable');
      }
    }

    async function remove(key) {
      try {
        await storage.remove(key);
      } catch (_error) {
        throw new Error('Instance storage unavailable');
      }
    }

    function normalizeIdentity(raw) {
      try {
        protocol.validationV2.exactObject(
          raw,
          ['version', 'instanceId', 'browser', 'profileAlias', 'deviceAlias', 'createdAt'],
          'instance identity'
        );
        if (raw.version !== 1 || raw.browser !== browser) fail('Invalid instance identity');
        return {
          version: 1,
          instanceId: protocol.validationV2.instanceId(raw.instanceId),
          browser: raw.browser,
          profileAlias: alias(raw.profileAlias, 'profileAlias'),
          deviceAlias: alias(raw.deviceAlias, 'deviceAlias'),
          createdAt: timestamp(raw.createdAt)
        };
      } catch (_error) {
        throw new TypeError('Invalid persisted instance identity');
      }
    }

    function normalizeGrant(raw, current, { requireActive = false } = {}) {
      try {
        protocol.validationV2.exactObject(
          raw,
          ['instanceId', 'expiresAt', 'revoked', 'actions', 'tabIds'],
          'instance grant'
        );
        const normalized = {
          instanceId: protocol.validationV2.instanceId(raw.instanceId),
          expiresAt: timestamp(raw.expiresAt),
          revoked: raw.revoked,
          actions: denseActions(raw.actions),
          tabIds: protocol.validationV2.tabIds(raw.tabIds, 'instance grant tabs')
        };
        if (typeof normalized.revoked !== 'boolean' ||
            normalized.expiresAt > current + MAX_GRANT_TTL_MS ||
            (requireActive && (normalized.revoked || normalized.expiresAt <= current))) {
          fail('Invalid instance grant');
        }
        return normalized;
      } catch (_error) {
        throw new TypeError('Invalid persisted instance grant');
      }
    }

    async function load() {
      const identityRaw = await read(identityKey);
      if (identityRaw === undefined || identityRaw === null) return null;
      const identity = normalizeIdentity(identityRaw);
      const current = timestamp(now());
      const grantRaw = await read(grantKey);
      let grant = null;
      if (grantRaw !== undefined && grantRaw !== null) {
        const candidate = normalizeGrant(grantRaw, current);
        if (!candidate.revoked && candidate.expiresAt > current) grant = candidate;
      }
      return { ...identity, grant };
    }

    async function create(profileAlias, deviceAlias) {
      const profile = alias(profileAlias, 'profileAlias');
      const device = alias(deviceAlias, 'deviceAlias');
      const existing = await load();
      if (existing) {
        if (existing.profileAlias !== profile || existing.deviceAlias !== device) {
          fail('Instance identity already exists with different aliases');
        }
        return existing;
      }
      const createdAt = timestamp(now());
      const generated = protocol.validationV2.instanceId(uuid());
      if (generated[14] !== '4') fail('Instance UUID must be random v4');
      const identity = {
        version: 1,
        instanceId: generated,
        browser,
        profileAlias: profile,
        deviceAlias: device,
        createdAt
      };
      await write(identityKey, identity);
      return { ...identity, grant: null };
    }

    async function grant(record) {
      const identity = await load();
      if (!identity) fail('Instance identity does not exist');
      const current = timestamp(now());
      const normalized = normalizeGrant(record, current, { requireActive: true });
      if (normalized.instanceId !== identity.instanceId) {
        fail('Instance grant targets another instance');
      }
      await write(grantKey, normalized);
      return { ...normalized, actions: [...normalized.actions], tabIds: [...normalized.tabIds] };
    }

    async function revoke() {
      if (!(await load())) fail('Instance identity does not exist');
      await remove(grantKey);
      return true;
    }

    async function safeSnapshot() {
      const state = await load();
      if (!state) return null;
      return {
        instanceId: state.instanceId,
        browser: state.browser,
        profileAlias: state.profileAlias,
        deviceAlias: state.deviceAlias,
        extensionVersion: currentExtensionVersion,
        protocolVersion
      };
    }

    return Object.freeze({ load, create, grant, revoke, safeSnapshot });
  }

  return Object.freeze({ MAX_GRANT_TTL_MS, createInstanceStore });
});
