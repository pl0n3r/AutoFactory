(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./factory-control-protocol.js')
      : root.ChatGPTAutopilotFactoryProtocol
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryAuthorization = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (protocol) {
  'use strict';

  const ACTIONS = new Set([
    'pause', 'resume', 'open_chat', 'set_prompt', 'set_mode', 'send_message'
  ]);
  const INSTANCE_ACTIONS = new Set(['pause', 'resume']);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const DENIED = 'Command not authorized';

  function deny() {
    throw new TypeError(DENIED);
  }

  function alias(value) {
    return typeof value === 'string' && value.length > 0 &&
      value.length <= 64 && value.trim() === value && !/[@\r\n\x00-\x1f]/.test(value);
  }

  function validInstanceId(value) {
    return typeof value === 'string' && UUID_RE.test(value);
  }

  function tabId(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function denseUnique(values, max, valid) {
    if (!Array.isArray(values) || values.length > max) deny();
    const seen = new Set();
    for (let index = 0; index < values.length; index++) {
      if (!Object.hasOwn(values, index) || !valid(values[index]) ||
          seen.has(values[index])) deny();
      seen.add(values[index]);
    }
    return seen;
  }

  function exactKeys(value, fields) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every(field => Object.hasOwn(value, field));
  }

  function exactDataObject(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== fields.length ||
        ownKeys.some(key => typeof key !== 'string' || !fields.includes(key))) return false;
    return fields.every(field => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return Object.hasOwn(value, field) && descriptor && descriptor.enumerable &&
        typeof descriptor.get !== 'function' && typeof descriptor.set !== 'function';
    });
  }

  function createCommandAuthorizer({ loadVerifiedGrant, now } = {}) {
    if (!protocol || typeof protocol.command !== 'function' ||
        typeof loadVerifiedGrant !== 'function' || typeof now !== 'function') {
      throw new TypeError('Verified pairing and clock adapters are required');
    }
    async function authorize(input, context) {
      try {
        // This validates the command, not the caller's identity. The bridge
        // must authenticate the sender BEFORE calling this preflight.
        const command = protocol.command(input);
        if (!exactKeys(context, ['profileAlias', 'enabledTabIds']) ||
            !alias(context.profileAlias)) deny();
        const enabledTabs = denseUnique(context.enabledTabIds, 40, tabId);
        const grant = await loadVerifiedGrant();
        if (!exactKeys(grant, [
          'profileAlias', 'expiresAt', 'revoked', 'actions', 'tabIds', 'broadcast'
        ]) || !alias(grant.profileAlias) ||
            !Number.isSafeInteger(grant.expiresAt) ||
            typeof grant.revoked !== 'boolean' ||
            typeof grant.broadcast !== 'boolean') deny();
        const current = now();
        if (!Number.isSafeInteger(current) || current < 0 ||
            grant.revoked || grant.expiresAt <= current ||
            // Require periodic explicit renewal of a verified pairing.
            grant.expiresAt > current + 86400000 ||
            grant.profileAlias !== context.profileAlias) deny();
        const actions = denseUnique(grant.actions, ACTIONS.size,
          value => typeof value === 'string' && ACTIONS.has(value));
        const tabs = denseUnique(grant.tabIds, 40, tabId);
        if (!actions.has(command.action)) deny();
        if (command.target === 'all') {
          if (!grant.broadcast || !['pause', 'resume'].includes(command.action)) deny();
        } else if (!tabs.has(command.target) || !enabledTabs.has(command.target)) {
          deny();
        }
        return command;
      } catch (_error) {
        // Never surface a grant, alias, message body or adapter exception.
        deny();
      }
    }
    return Object.freeze({ authorize });
  }

  function createInstanceCommandAuthorizer({ loadVerifiedGrant, now } = {}) {
    if (!protocol || typeof protocol.commandV2 !== 'function' ||
        typeof loadVerifiedGrant !== 'function' || typeof now !== 'function') {
      throw new TypeError('Verified instance grant and clock adapters are required');
    }

    async function authorize(input, context) {
      try {
        const command = protocol.commandV2(input);
        if (!exactDataObject(context, ['instanceId', 'enabledTabIds']) ||
            !validInstanceId(context.instanceId) ||
            command.instanceId !== context.instanceId) deny();

        const current = now();
        if (!Number.isSafeInteger(current) || current < 0 ||
            command.issuedAt > current || command.expiresAt <= current) deny();

        const enabledTabs = denseUnique(context.enabledTabIds, 40, tabId);
        const grant = await loadVerifiedGrant();
        if (!exactDataObject(grant, [
          'instanceId', 'expiresAt', 'revoked', 'actions', 'tabIds'
        ]) || !validInstanceId(grant.instanceId) ||
            !Number.isSafeInteger(grant.expiresAt) ||
            typeof grant.revoked !== 'boolean') deny();

        if (grant.revoked || grant.instanceId !== command.instanceId ||
            grant.instanceId !== context.instanceId ||
            grant.expiresAt <= current ||
            grant.expiresAt > current + 86400000) deny();

        const actions = denseUnique(
          grant.actions,
          INSTANCE_ACTIONS.size,
          value => typeof value === 'string' && INSTANCE_ACTIONS.has(value)
        );
        const allowedTabs = denseUnique(grant.tabIds, 40, tabId);
        if (!actions.has(command.action)) deny();

        if (command.target === 'instance') {
          for (const tab of enabledTabs) {
            if (!allowedTabs.has(tab)) deny();
          }
        } else if (!enabledTabs.has(command.target) || !allowedTabs.has(command.target)) {
          deny();
        }
        return command;
      } catch (_error) {
        // Fail closed without exposing grant contents, instance IDs or adapter errors.
        deny();
      }
    }

    return Object.freeze({ authorize });
  }

  return Object.freeze({ createCommandAuthorizer, createInstanceCommandAuthorizer });
});
