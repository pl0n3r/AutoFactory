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

  function freezeHeartbeat(body) {
    body.tabs.forEach(tab => Object.freeze(tab));
    Object.freeze(body.tabs);
    return Object.freeze(body);
  }

  function freezeCommand(command) {
    if (command.payload && typeof command.payload === 'object') {
      Object.freeze(command.payload);
    }
    return Object.freeze(command);
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
      const body = freezeHeartbeat(protocol.heartbeat(input));
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
        command: freezeCommand(protocol.command(input.command))
      });
    }

    return Object.freeze({
      heartbeatRequest,
      nextCommandRequest,
      acknowledgementRequest,
      commandResponse
    });
  }


  function credential(value) {
    exactObject(value, ['id', 'expiresAt'], 'credential');
    if (typeof value.id !== 'string' || value.id.length < 8 || value.id.length > 80 ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value.id) ||
        !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 1) {
      throw new TypeError('credential is invalid');
    }
    return value;
  }

  function descriptorForProfile(profileAlias, value) {
    exactObject(value, [
      'origin', 'method', 'path', 'timeoutMs', 'authScope', 'query', 'body'
    ], 'transport descriptor');
    if (value.origin !== ORIGIN || value.authScope !== 'profile') {
      throw new TypeError('transport descriptor is invalid');
    }
    if (value.path === HEARTBEAT_PATH) {
      if (value.method !== 'POST' || value.timeoutMs !== 10_000 || value.query !== null ||
          !value.body || value.body.profileAlias !== profileAlias) {
        throw new TypeError('transport descriptor is invalid');
      }
    } else if (value.path === COMMAND_PATH) {
      if (value.method !== 'GET' || value.body !== null ||
          value.timeoutMs < MIN_LONG_POLL_MS + 5_000 ||
          value.timeoutMs > MAX_LONG_POLL_MS + 5_000) {
        throw new TypeError('transport descriptor is invalid');
      }
      exactObject(value.query, ['profileAlias', 'cursor', 'waitMs'], 'command query');
      if (value.query.profileAlias !== profileAlias ||
          value.timeoutMs !== longPoll(value.query.waitMs) + 5_000) {
        throw new TypeError('transport descriptor is invalid');
      }
      cursor(value.query.cursor);
    } else if (value.path === ACK_PATH) {
      if (value.method !== 'POST' || value.timeoutMs !== 10_000 ||
          value.query !== null || !value.body) {
        throw new TypeError('transport descriptor is invalid');
      }
    } else {
      throw new TypeError('transport descriptor is invalid');
    }
    return value;
  }

  function response(value, credentialId) {
    exactObject(value, ['status', 'body'], 'transport response');
    if (!Number.isSafeInteger(value.status) || value.status < 100 || value.status > 599) {
      throw new TypeError('transport response is invalid');
    }
    let serialized;
    try {
      serialized = JSON.stringify(value.body);
    } catch (_error) {
      throw new TypeError('transport response is invalid');
    }
    if (typeof serialized !== 'string' || serialized.includes(credentialId)) {
      throw new TypeError('transport response is invalid');
    }
    return Object.freeze({ status: value.status, body: JSON.parse(serialized) });
  }

  function createCredentialBoundInvoker({ credentialStore, invoke, now } = {}) {
    if (!credentialStore || typeof credentialStore.load !== 'function' ||
        typeof invoke !== 'function' || typeof now !== 'function') {
      throw new TypeError('Credential-bound transport dependencies are required');
    }

    async function execute(input) {
      let profileAlias;
      try {
        exactObject(input, ['profileAlias', 'request'], 'credential-bound input');
        profileAlias = alias(input.profileAlias);
        const request = descriptorForProfile(profileAlias, input.request);
        const current = now();
        if (!Number.isSafeInteger(current) || current < 0) {
          return Object.freeze({ ok: false, code: 'failed' });
        }
        const loaded = await credentialStore.load(profileAlias);
        if (loaded === null) {
          return Object.freeze({ ok: false, code: 'unauthorized' });
        }
        const auth = credential(loaded);
        if (auth.expiresAt <= current || auth.expiresAt > current + 86_400_000) {
          return Object.freeze({ ok: false, code: 'unauthorized' });
        }
        const result = await invoke(Object.freeze({
          credentialId: auth.id,
          request
        }));
        return Object.freeze({
          ok: true,
          code: 'authorized',
          response: response(result, auth.id)
        });
      } catch (_error) { // NOSONAR: sensitive transport/store errors are intentionally collapsed to a fixed public result.
        // Never expose profile alias, opaque credential, adapter details or response bodies in errors.
        return Object.freeze({ ok: false, code: 'failed' });
      }
    }

    return Object.freeze({ execute });
  }

  return Object.freeze({
    ORIGIN,
    DEFAULT_LONG_POLL_MS,
    createTransportContract,
    createCredentialBoundInvoker
  });
});
