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
  const COMMAND_ACK_CODES = new Set([
    'ok', 'invalid', 'not_found', 'not_ready', 'timeout', 'unauthorized',
    'already_handled', 'failed'
  ]);

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
        const request = descriptorForProfile(profileAlias, structuredClone(input.request));
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


  function checkedInvocation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof value.ok !== 'boolean' || typeof value.code !== 'string') {
      throw new TypeError('transport invocation is invalid');
    }
    if (value.ok === false) {
      exactObject(value, ['ok', 'code'], 'transport invocation');
      if (!['unauthorized', 'failed'].includes(value.code)) {
        throw new TypeError('transport invocation is invalid');
      }
      return value;
    }
    exactObject(value, ['ok', 'code', 'response'], 'transport invocation');
    if (value.code !== 'authorized' || !value.response ||
        typeof value.response !== 'object' || Array.isArray(value.response) ||
        !Number.isSafeInteger(value.response.status) ||
        !Object.hasOwn(value.response, 'body')) {
      throw new TypeError('transport invocation is invalid');
    }
    return value;
  }

  function checkedActivation(value) {
    exactObject(value, ['allowed', 'code'], 'activation decision');
    if (typeof value.allowed !== 'boolean' || typeof value.code !== 'string') {
      throw new TypeError('activation decision is invalid');
    }
    if (value.allowed === true) {
      if (value.code !== 'ready') throw new TypeError('activation decision is invalid');
      return 'ready';
    }
    if (['unpaired', 'consent_denied', 'legal_blocked'].includes(value.code)) {
      return 'unauthorized';
    }
    if (['invalid', 'failed'].includes(value.code)) return 'failed';
    throw new TypeError('activation decision is invalid');
  }

  function createAuthenticatedTransportClient({ transport, invoker, activation } = {}) {
    if (!transport || typeof transport.heartbeatRequest !== 'function' ||
        typeof transport.nextCommandRequest !== 'function' ||
        typeof transport.acknowledgementRequest !== 'function' ||
        typeof transport.commandResponse !== 'function' ||
        !invoker || typeof invoker.execute !== 'function' ||
        !activation || typeof activation.evaluate !== 'function') {
      throw new TypeError('Authenticated transport dependencies are required');
    }
    const heartbeatRequest = transport.heartbeatRequest.bind(transport);
    const nextCommandRequest = transport.nextCommandRequest.bind(transport);
    const acknowledgementRequest = transport.acknowledgementRequest.bind(transport);
    const commandResponse = transport.commandResponse.bind(transport);
    const execute = invoker.execute.bind(invoker);
    const evaluateActivation = activation.evaluate.bind(activation);

    function failed(code = 'failed') {
      return Object.freeze({ ok: false, code });
    }
    async function invoke(profileAlias, request) {
      const activationCode = checkedActivation(
        await evaluateActivation(Object.freeze({ profileAlias }))
      );
      if (activationCode !== 'ready') return failed(activationCode);
      return checkedInvocation(await execute(Object.freeze({
        profileAlias,
        request
      })));
    }

    async function sendHeartbeat(input) {
      try {
        const snapshot = structuredClone(input);
        const profileAlias = alias(snapshot.profileAlias);
        const request = heartbeatRequest(snapshot);
        const result = await invoke(profileAlias, request);
        if (!result.ok) return failed(result.code);
        if (![200, 204].includes(result.response.status)) return failed();
        return Object.freeze({ ok: true, code: 'sent' });
      } catch (_error) { // NOSONAR: public facade intentionally collapses validation/adapter details.
        return failed();
      }
    }

    async function nextCommand(input) {
      try {
        const snapshot = structuredClone(input);
        exactObject(snapshot, ['profileAlias', 'cursor'], 'next command client input');
        const profileAlias = alias(snapshot.profileAlias);
        const request = nextCommandRequest(snapshot);
        const result = await invoke(profileAlias, request);
        if (!result.ok) return failed(result.code);
        if (result.response.status === 204) {
          return Object.freeze({
            ok: true,
            code: 'empty',
            cursor: request.query.cursor,
            command: null
          });
        }
        if (result.response.status !== 200) return failed();
        const parsed = commandResponse(result.response.body);
        return Object.freeze({
          ok: true,
          code: 'command',
          cursor: parsed.cursor,
          command: parsed.command
        });
      } catch (_error) { // NOSONAR: public facade intentionally collapses validation/adapter details.
        return failed();
      }
    }

    async function sendAck(input) {
      try {
        const snapshot = structuredClone(input);
        exactObject(snapshot, ['profileAlias', 'ack'], 'ack client input');
        const profileAlias = alias(snapshot.profileAlias);
        let ackInput = snapshot.ack;
        if (ackInput && typeof ackInput === 'object' && !Array.isArray(ackInput) &&
            Object.hasOwn(ackInput, 'version')) {
          const normalized = checkedAck(ackInput);
          ackInput = { id: normalized.id, ok: normalized.ok, code: normalized.code };
        }
        const request = acknowledgementRequest(ackInput);
        const result = await invoke(profileAlias, request);
        if (!result.ok) return failed(result.code);
        if (![200, 204].includes(result.response.status)) return failed();
        return Object.freeze({ ok: true, code: 'sent' });
      } catch (_error) { // NOSONAR: public facade intentionally collapses validation/adapter details.
        return failed();
      }
    }

    return Object.freeze({ sendHeartbeat, nextCommand, sendAck });
  }


  function checkedAck(value) {
    exactObject(value, ['version', 'kind', 'id', 'ok', 'code'], 'command ACK');
    if (value.version !== 1 || value.kind !== 'ack' ||
        typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 80 ||
        typeof value.ok !== 'boolean' || !COMMAND_ACK_CODES.has(value.code) ||
        value.ok !== (value.code === 'ok')) {
      throw new TypeError('command ACK is invalid');
    }
    return Object.freeze({
      version: value.version,
      kind: value.kind,
      id: value.id,
      ok: value.ok,
      code: value.code
    });
  }

  function enabledTabs(value) {
    if (!Array.isArray(value) || value.length > 40) {
      throw new TypeError('enabledTabIds is invalid');
    }
    const seen = new Set();
    return value.map((tabId, index) => {
      if (!Object.hasOwn(value, index) || !Number.isSafeInteger(tabId) ||
          tabId < 0 || seen.has(tabId)) {
        throw new TypeError('enabledTabIds is invalid');
      }
      seen.add(tabId);
      return tabId;
    });
  }

  function safeBusyCursor(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        !Object.hasOwn(input, 'cursor')) return null;
    try {
      return cursor(input.cursor);
    } catch (_error) { // NOSONAR: busy path must never reflect an invalid caller value.
      return null;
    }
  }

  function createCommandPump({ client, executor } = {}) {
    if (!client || typeof client.nextCommand !== 'function' ||
        typeof client.sendAck !== 'function' ||
        !executor || typeof executor.execute !== 'function') {
      throw new TypeError('Command pump dependencies are required');
    }
    const nextCommand = client.nextCommand.bind(client);
    const sendAck = client.sendAck.bind(client);
    const execute = executor.execute.bind(executor);
    let inFlight = false;

    function failed(code, cursorValue) {
      return Object.freeze({ ok: false, code, cursor: cursorValue });
    }

    async function runOnce(input) {
      if (inFlight) {
        return failed('busy', safeBusyCursor(input));
      }
      inFlight = true;
      let previousCursor = null;
      try {
        const snapshot = structuredClone(input);
        exactObject(snapshot, ['profileAlias', 'cursor', 'context'], 'command pump input');
        const profileAlias = alias(snapshot.profileAlias);
        previousCursor = cursor(snapshot.cursor);
        exactObject(snapshot.context, ['profileAlias', 'enabledTabIds'], 'command pump context');
        if (alias(snapshot.context.profileAlias) !== profileAlias) {
          return failed('failed', previousCursor);
        }
        const enabledTabIds = enabledTabs(snapshot.context.enabledTabIds);
        const poll = await nextCommand(Object.freeze({
          profileAlias,
          cursor: previousCursor
        }));
        if (!poll || typeof poll !== 'object' || Array.isArray(poll) ||
            typeof poll.ok !== 'boolean' || typeof poll.code !== 'string') {
          return failed('failed', previousCursor);
        }
        if (!poll.ok) {
          return failed(
            ['unauthorized', 'failed'].includes(poll.code) ? poll.code : 'failed',
            previousCursor
          );
        }
        if (poll.code === 'empty') {
          exactObject(poll, ['ok', 'code', 'cursor', 'command'], 'empty poll result');
          if (poll.command !== null) return failed('failed', previousCursor);
          return Object.freeze({
            ok: true,
            code: 'empty',
            cursor: cursor(poll.cursor)
          });
        }
        if (poll.code !== 'command') return failed('failed', previousCursor);
        exactObject(poll, ['ok', 'code', 'cursor', 'command'], 'command poll result');
        const nextCursor = cursor(poll.cursor);
        const command = structuredClone(poll.command);
        if (!command || typeof command !== 'object' || Array.isArray(command) ||
            typeof command.id !== 'string' || command.id.length < 1 || command.id.length > 80) {
          return failed('failed', previousCursor);
        }
        const ack = checkedAck(await execute(
          command,
          Object.freeze({ profileAlias, enabledTabIds: Object.freeze(enabledTabIds) })
        ));
        if (ack.id !== command.id) return failed('failed', previousCursor);
        const sent = await sendAck(Object.freeze({
          profileAlias,
          ack
        }));
        if (!sent || typeof sent !== 'object' || sent.ok !== true || sent.code !== 'sent') {
          return failed('ack_failed', previousCursor);
        }
        return Object.freeze({
          ok: true,
          code: 'handled',
          cursor: nextCursor,
          commandId: ack.id,
          outcome: ack.code
        });
      } catch (_error) { // NOSONAR: orchestration intentionally collapses adapter/payload details.
        return failed('failed', previousCursor);
      } finally {
        inFlight = false;
      }
    }

    return Object.freeze({ runOnce });
  }

  return Object.freeze({
    ORIGIN,
    DEFAULT_LONG_POLL_MS,
    createTransportContract,
    createCredentialBoundInvoker,
    createAuthenticatedTransportClient,
    createCommandPump
  });
});
