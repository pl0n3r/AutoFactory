(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryInstanceTransport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_FRAME_BYTES = 16 * 1024;
  const MIN_RETRY_MS = 1_000;
  const MAX_RETRY_MS = 30_000;
  const STATES = new Set(['stopped', 'connecting', 'connected', 'backoff']);
  const RECEIPT_CODES = new Set([
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

  function checkedNow(clock) {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('clock is invalid');
    }
    return value;
  }

  function frameBytes(value) {
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch (_error) {
      throw new TypeError('frame is invalid');
    }
    if (typeof serialized !== 'string') throw new TypeError('frame is invalid');
    return new TextEncoder().encode(serialized).byteLength;
  }

  function checkedMetadata(value) {
    exactObject(value, ['authenticated'], 'adapter metadata');
    if (typeof value.authenticated !== 'boolean') {
      throw new TypeError('adapter metadata is invalid');
    }
    return value.authenticated;
  }

  function checkedFrame(value) {
    exactObject(value, ['version', 'kind', 'command'], 'local-agent frame');
    if (value.version !== 2 || value.kind !== 'command' ||
        !value.command || typeof value.command !== 'object' ||
        Array.isArray(value.command)) {
      throw new TypeError('local-agent frame is invalid');
    }
    return structuredClone(value.command);
  }

  function checkedReceipt(value) {
    exactObject(
      value,
      ['version', 'kind', 'id', 'instanceId', 'ok', 'code', 'enabled', 'appliedTabs'],
      'instance receipt'
    );
    if (value.version !== 2 || value.kind !== 'ack' ||
        typeof value.id !== 'string' || !value.id ||
        typeof value.instanceId !== 'string' || !value.instanceId ||
        typeof value.ok !== 'boolean' || !RECEIPT_CODES.has(value.code) ||
        value.ok !== (value.code === 'ok') ||
        typeof value.enabled !== 'boolean' ||
        !Array.isArray(value.appliedTabs) ||
        value.appliedTabs.some(tabId => !Number.isSafeInteger(tabId) || tabId < 0)) {
      throw new TypeError('instance receipt is invalid');
    }
    return Object.freeze({
      version: value.version,
      kind: value.kind,
      id: value.id,
      instanceId: value.instanceId,
      ok: value.ok,
      code: value.code,
      enabled: value.enabled,
      appliedTabs: Object.freeze([...value.appliedTabs])
    });
  }

  function createLocalAgentTransportBoundary({
    connect,
    instanceStore,
    runtime,
    clock = Date.now,
    schedule = setTimeout,
    cancelSchedule = clearTimeout
  } = {}) {
    if (typeof connect !== 'function' ||
        !instanceStore || typeof instanceStore.safeSnapshot !== 'function' ||
        !runtime || typeof runtime.execute !== 'function' ||
        typeof clock !== 'function' || typeof schedule !== 'function' ||
        typeof cancelSchedule !== 'function') {
      throw new TypeError('Local-agent transport dependencies are required');
    }

    let running = false;
    let state = 'stopped';
    let attempt = 0;
    let retryToken = null;
    let nextRetryMs = null;
    let connection = null;
    let connectionEpoch = 0;
    let activeEpoch = 0;
    let frames = 0;
    let failures = 0;
    checkedNow(clock);

    function transition(nextState) {
      if (!STATES.has(nextState)) throw new TypeError('transport state is invalid');
      checkedNow(clock);
      state = nextState;
    }

    function status() {
      return Object.freeze({
        state,
        attempt,
        nextRetryMs,
        frames,
        failures
      });
    }

    function safeFailure(code) {
      failures += 1;
      return Object.freeze({ ok: false, code });
    }

    async function handleFrame(frame, metadata, sourceEpoch) {
      if (!running || state !== 'connected' || sourceEpoch !== activeEpoch) {
        return safeFailure('not_ready');
      }

      let authenticated;
      try {
        authenticated = checkedMetadata(metadata);
      } catch (_error) { // NOSONAR: malformed adapter metadata is deliberately collapsed to unauthorized.
        return safeFailure('unauthorized');
      }
      if (!authenticated) return safeFailure('unauthorized');

      let command;
      try {
        if (frameBytes(frame) > MAX_FRAME_BYTES) return safeFailure('invalid');
        command = checkedFrame(frame);
      } catch (_error) { // NOSONAR: malformed peer frames never expose parser details.
        return safeFailure('invalid');
      }

      try {
        checkedNow(clock);
        const snapshot = await instanceStore.safeSnapshot();
        if (snapshot === null) return safeFailure('not_ready');
        frames += 1;
        return checkedReceipt(await runtime.execute(command));
      } catch (_error) {
        // Runtime/store details are intentionally collapsed to the fixed public failed code.
        return safeFailure('failed');
      }
    }

    function clearRetry() {
      if (retryToken !== null) {
        try {
          cancelSchedule(retryToken);
        } catch (_error) {
          // Scheduler details are intentionally discarded at this boundary.
        }
        retryToken = null;
      }
      nextRetryMs = null;
    }

    function retryDelay() {
      const exponent = Math.min(Math.max(attempt - 1, 0), 20);
      return Math.min(MIN_RETRY_MS * (2 ** exponent), MAX_RETRY_MS);
    }

    function scheduleReconnect() {
      if (!running) return;
      attempt += 1;
      const delay = retryDelay();
      nextRetryMs = delay;
      transition('backoff');
      try {
        retryToken = schedule(async () => {
          retryToken = null;
          nextRetryMs = null;
          await open();
        }, delay);
      } catch (_error) {
        failures += 1;
        running = false;
        transition('stopped');
      }
    }

    async function handleClose(sourceEpoch) {
      if (sourceEpoch !== activeEpoch) return;
      activeEpoch = 0;
      connection = null;
      if (running) scheduleReconnect();
    }

    async function open() {
      if (!running) return status();
      clearRetry();
      transition('connecting');
      const sourceEpoch = ++connectionEpoch;
      try {
        const candidate = await connect(Object.freeze({
          onFrame(frame, metadata) {
            return handleFrame(frame, metadata, sourceEpoch);
          },
          onClose() {
            return handleClose(sourceEpoch);
          }
        }));
        if (!candidate || typeof candidate !== 'object' ||
            typeof candidate.close !== 'function') {
          throw new TypeError('Local-agent adapter is invalid');
        }
        if (!running) {
          try {
            await candidate.close();
          } catch (_error) { // NOSONAR: stop-race cleanup is best-effort and has no public error channel.
          }
          return status();
        }
        connection = candidate;
        activeEpoch = sourceEpoch;
        attempt = 0;
        transition('connected');
      } catch (_error) {
        // Connection adapter failures are handled as opaque reconnectable transport failures.
        failures += 1;
        connection = null;
        scheduleReconnect();
      }
      return status();
    }

    async function start() {
      if (running) return status();
      running = true;
      await open();
      return status();
    }

    async function stop() {
      running = false;
      clearRetry();
      const active = connection;
      activeEpoch = 0;
      connection = null;
      if (active) {
        try {
          await active.close();
        } catch (_error) {
          failures += 1;
        }
      }
      attempt = 0;
      transition('stopped');
      return status();
    }

    return Object.freeze({ start, stop, status });
  }

  return Object.freeze({
    MAX_FRAME_BYTES,
    MIN_RETRY_MS,
    MAX_RETRY_MS,
    createLocalAgentTransportBoundary
  });
});
