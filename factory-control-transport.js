(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryTransport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ORIGIN = 'https://control.condorapp.com.co';
  const HEARTBEAT_PATH = '/v1/bridge/heartbeat';
  const COMMAND_PATH = '/v1/bridge/commands/next';
  const ACK_PATH = '/v1/bridge/commands/ack';
  const DEFAULT_LONG_POLL_MS = 25_000;
  const MIN_LONG_POLL_MS = 5_000;
  const MAX_LONG_POLL_MS = 30_000;

  function exactObject(value, fields, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== fields.length ||
        !fields.every(field => Object.hasOwn(value, field))) {
      throw new TypeError(label + ' is invalid');
    }
    return value;
  }

  function alias(value) {
    if (typeof value !== 'string' || value.trim() !== value || !value ||
        value.length > 64 || /[@\r\n\x00-\x1f]/.test(value)) {
      throw new TypeError('profileAlias is invalid');
    }
    return value;
  }

  function cursor(value) {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length < 1 || value.length > 128 ||
        !/^[A-Za-z0-9._:-]+$/.test(value)) {
      throw new TypeError('cursor is invalid');
    }
    return value;
  }

  function longPoll(value) {
    if (!Number.isSafeInteger(value) ||
        value < MIN_LONG_POLL_MS || value > MAX_LONG_POLL_MS) {
      throw new TypeError('longPollMs is invalid');
    }
    return value;
  }

  function descriptor(method, path, timeoutMs, query, body) {
    return Object.freeze({
      origin: ORIGIN,
      method,
      path,
      timeoutMs,
      authScope: 'profile',
      query: query === null ? null : Object.freeze({ ...query }),
      body
    });
  }

  function createTransportContract({ protocol, longPollMs = DEFAULT_LONG_POLL_MS } = {}) {
    if (!protocol ||
        typeof protocol.heartbeat !== 'function' ||
        typeof protocol.command !== 'function' ||
        typeof protocol.acknowledgement !== 'function') {
      throw new TypeError('Protocol v1 validators are required');
    }
    const waitMs = longPoll(longPollMs);

    function heartbeatRequest(input) {
      const body = Object.freeze(protocol.heartbeat(input));
      return descriptor('POST', HEARTBEAT_PATH, 10_000, null, body);
    }

    function nextCommandRequest(input) {
      exactObject(input, ['profileAlias', 'cursor'], 'next command input');
      const query = {
        profileAlias: alias(input.profileAlias),
        cursor: cursor(input.cursor),
        waitMs
      };
      return descriptor('GET', COMMAND_PATH, waitMs + 5_000, query, null);
    }

    function acknowledgementRequest(input) {
      const body = Object.freeze(protocol.acknowledgement(input));
      return descriptor('POST', ACK_PATH, 10_000, null, body);
    }

    function commandResponse(input) {
      exactObject(input, ['cursor', 'command'], 'command response');
      return Object.freeze({
        cursor: cursor(input.cursor),
        command: Object.freeze(protocol.command(input.command))
      });
    }

    return Object.freeze({
      heartbeatRequest,
      nextCommandRequest,
      acknowledgementRequest,
      commandResponse
    });
  }

  return Object.freeze({
    ORIGIN,
    DEFAULT_LONG_POLL_MS,
    createTransportContract
  });
});
