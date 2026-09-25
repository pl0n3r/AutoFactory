(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Contract-only module. No network, credentials, chat DOM or extension permissions.
  const VERSION = 1;
  const TAB_STATES = new Set([
    'paused', 'waiting', 'generating', 'sending', 'error', 'limit', 'requires_login'
  ]);
  const ACTIONS = new Set([
    'pause', 'resume', 'open_chat', 'set_prompt', 'set_mode', 'send_message'
  ]);
  const ERROR_CODES = new Set([
    'ok', 'invalid', 'not_found', 'not_ready', 'timeout', 'unauthorized',
    'already_handled', 'failed'
  ]);

  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(label + ' must be an object');
    }
    return value;
  }

  function keys(value, allowed, label) {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) throw new TypeError(label + ' has an unsupported field');
    }
  }

  function identifier(value, label) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) {
      throw new TypeError(label + ' is invalid');
    }
    return value;
  }

  function alias(value, label) {
    if (typeof value !== 'string' || value.trim() !== value || !value ||
        value.length > 64 || /[@\r\n\x00-\x1f]/.test(value)) {
      throw new TypeError(label + ' must be a short alias, not an email or secret');
    }
    return value;
  }

  function tabId(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid tab ID');
    return value;
  }

  function heartbeat(input) {
    object(input, 'heartbeat');
    keys(input, ['profileAlias', 'accountAlias', 'tabs', 'lastEvent'], 'heartbeat');
    if (!Array.isArray(input.tabs) || input.tabs.length > 40) {
      throw new TypeError('Too many tabs or missing tabs');
    }
    const seen = new Set();
    const tabs = input.tabs.map(tab => {
      object(tab, 'tab');
      keys(tab, ['tabId', 'enabled', 'state'], 'tab');
      const id = tabId(tab.tabId);
      if (seen.has(id)) throw new TypeError('Duplicate tab ID');
      seen.add(id);
      if (typeof tab.enabled !== 'boolean' || !TAB_STATES.has(tab.state)) {
        throw new TypeError('Invalid tab metadata');
      }
      return { tabId: id, enabled: tab.enabled, state: tab.state };
    });
    let lastEvent = null;
    if (input.lastEvent !== undefined && input.lastEvent !== null) {
      if (typeof input.lastEvent !== 'string' ||
          !/^[a-z][a-z0-9-]{0,63}$/.test(input.lastEvent)) {
        throw new TypeError('Invalid diagnostic event code');
      }
      lastEvent = input.lastEvent;
    }
    return {
      version: VERSION, kind: 'heartbeat',
      profileAlias: alias(input.profileAlias, 'profileAlias'),
      accountAlias: alias(input.accountAlias, 'accountAlias'),
      tabs, lastEvent
    };
  }

  function command(input) {
    object(input, 'command');
    keys(input, ['id', 'action', 'target', 'payload'], 'command');
    const id = identifier(input.id, 'command ID');
    if (!ACTIONS.has(input.action)) throw new TypeError('Unsupported command action');
    const target = input.target === 'all' ? 'all' : tabId(input.target);
    const action = input.action;
    let payload = null;
    if (action === 'send_message' || action === 'set_prompt') {
      object(input.payload, 'payload');
      keys(input.payload, ['text'], 'payload');
      if (typeof input.payload.text !== 'string' || !input.payload.text.trim() ||
          input.payload.text.length > 16000) throw new TypeError('Invalid message length');
      payload = { text: input.payload.text };
    } else if (action === 'set_mode') {
      object(input.payload, 'payload');
      keys(input.payload, ['mode'], 'payload');
      if (!['chat', 'work'].includes(input.payload.mode)) {
        throw new TypeError('Unsupported conversation mode');
      }
      payload = { mode: input.payload.mode };
    } else if (input.payload !== undefined && input.payload !== null) {
      throw new TypeError('Unexpected command payload');
    }
    return { version: VERSION, kind: 'command', id, action, target, payload };
  }

  function acknowledgement(input) {
    object(input, 'acknowledgement');
    keys(input, ['id', 'ok', 'code'], 'acknowledgement');
    const id = identifier(input.id, 'command ID');
    if (typeof input.ok !== 'boolean' || !ERROR_CODES.has(input.code) ||
        input.ok !== (input.code === 'ok')) {
      throw new TypeError('Invalid acknowledgement result');
    }
    return { version: VERSION, kind: 'ack', id, ok: input.ok, code: input.code };
  }

  return Object.freeze({ VERSION, heartbeat, command, acknowledgement });
});
