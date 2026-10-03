(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HEARTBEAT_CODES = new Set([
    'sent', 'denied', 'failed', 'busy', 'throttled', 'stopped'
  ]);
  const PUMP_FAILURE_CODES = new Set([
    'unauthorized', 'failed', 'ack_failed', 'busy'
  ]);
  const PUMP_SUCCESS_CODES = new Set(['empty', 'handled']);

  function result(ok, code, cursorValue) {
    if (arguments.length < 3) return Object.freeze({ ok, code });
    return Object.freeze({ ok, code, cursor: cursorValue });
  }

  function exactObject(value, fields, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(label + ' is invalid');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length ||
        keys.some(key => typeof key !== 'string' || !fields.includes(key))) {
      throw new TypeError(label + ' is invalid');
    }
    const copy = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError(label + ' is invalid');
      }
      copy[field] = descriptor.value;
    }
    return copy;
  }

  function profileAlias(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 64 ||
        value.trim() !== value || /[@\r\n\x00-\x1f]/.test(value)) {
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

  function tabIds(value) {
    if (!Array.isArray(value) || value.length > 40) {
      throw new TypeError('enabledTabIds is invalid');
    }
    const seen = new Set();
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !Number.isSafeInteger(value[index]) ||
          value[index] < 0 || seen.has(value[index])) {
        throw new TypeError('enabledTabIds is invalid');
      }
      seen.add(value[index]);
      copy.push(value[index]);
    }
    return Object.freeze(copy);
  }

  function normalizePump(value, previousCursor) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof value.ok !== 'boolean' || typeof value.code !== 'string') {
      throw new TypeError('pump result is invalid');
    }

    if (value.ok === false) {
      const failure = exactObject(value, ['ok', 'code', 'cursor'], 'pump failure');
      if (!PUMP_FAILURE_CODES.has(failure.code) ||
          cursor(failure.cursor) !== previousCursor) {
        throw new TypeError('pump result is invalid');
      }
      return result(false, failure.code, previousCursor);
    }

    if (!PUMP_SUCCESS_CODES.has(value.code)) {
      throw new TypeError('pump result is invalid');
    }
    const fields = value.code === 'empty'
      ? ['ok', 'code', 'cursor']
      : ['ok', 'code', 'cursor', 'commandId', 'outcome'];
    const success = exactObject(value, fields, 'pump success');
    return result(true, success.code, cursor(success.cursor));
  }

  function createFactoryControlRuntime({ createHeartbeat, pump, loadContext } = {}) {
    if (typeof createHeartbeat !== 'function' ||
        !pump || typeof pump.runOnce !== 'function' ||
        typeof loadContext !== 'function') {
      throw new TypeError('Factory Control runtime dependencies are required');
    }

    const makeHeartbeat = createHeartbeat;
    const runPump = pump.runOnce.bind(pump);
    const readContext = loadContext;
    let generation = 0;
    let session = null;
    let heartbeat = null;
    let commandsBusy = false;

    function current(observedGeneration) {
      return session !== null && session.generation === observedGeneration;
    }

    function start(input) {
      if (session !== null) return result(false, 'already_started');
      if (commandsBusy) return result(false, 'busy');

      let initial;
      let alias;
      let initialCursor;
      try {
        initial = exactObject(input, ['profileAlias', 'cursor'], 'runtime start input');
        alias = profileAlias(initial.profileAlias);
        initialCursor = cursor(initial.cursor);
      } catch (_error) {
        return result(false, 'invalid');
      }

      try {
        const instance = makeHeartbeat(Object.freeze({ profileAlias: alias }));
        const ports = exactObject(instance, ['tick', 'stop'], 'heartbeat instance');
        if (typeof ports.tick !== 'function' || typeof ports.stop !== 'function') {
          throw new TypeError('heartbeat instance is invalid');
        }
        heartbeat = Object.freeze({
          tick: ports.tick.bind(instance),
          stop: ports.stop.bind(instance)
        });
      } catch (_error) {
        heartbeat = null;
        return result(false, 'failed');
      }

      generation += 1;
      session = Object.freeze({
        profileAlias: alias,
        cursor: initialCursor,
        generation
      });
      return result(true, 'started');
    }

    async function runHeartbeat() {
      if (session === null || heartbeat === null) return result(false, 'stopped');
      const observedGeneration = session.generation;
      try {
        const code = await heartbeat.tick();
        if (!current(observedGeneration)) return result(false, 'stopped');
        if (typeof code !== 'string' || !HEARTBEAT_CODES.has(code)) {
          return result(false, 'failed');
        }
        return result(['sent', 'busy', 'throttled'].includes(code), code);
      } catch (_error) {
        return current(observedGeneration)
          ? result(false, 'failed')
          : result(false, 'stopped');
      }
    }

    async function runCommands() {
      if (session === null) return result(false, 'stopped');
      if (commandsBusy) return result(false, 'busy', session.cursor);

      commandsBusy = true;
      const observed = session;
      try {
        const rawContext = await readContext(Object.freeze({
          profileAlias: observed.profileAlias
        }));
        if (!current(observed.generation)) return result(false, 'stopped');

        const context = exactObject(
          rawContext,
          ['profileAlias', 'enabledTabIds'],
          'runtime context'
        );
        if (profileAlias(context.profileAlias) !== observed.profileAlias) {
          return result(false, 'failed', observed.cursor);
        }
        const enabledTabIds = tabIds(context.enabledTabIds);

        const pumpResult = await runPump(Object.freeze({
          profileAlias: observed.profileAlias,
          cursor: observed.cursor,
          context: Object.freeze({
            profileAlias: observed.profileAlias,
            enabledTabIds
          })
        }));
        if (!current(observed.generation)) return result(false, 'stopped');

        const normalized = normalizePump(pumpResult, observed.cursor);
        if (normalized.ok) {
          session = Object.freeze({
            profileAlias: observed.profileAlias,
            cursor: normalized.cursor,
            generation: observed.generation
          });
        }
        return normalized;
      } catch (_error) {
        return current(observed.generation)
          ? result(false, 'failed', observed.cursor)
          : result(false, 'stopped');
      } finally {
        commandsBusy = false;
      }
    }

    function stop() {
      generation += 1;
      session = null;
      const activeHeartbeat = heartbeat;
      heartbeat = null;
      if (activeHeartbeat === null) return result(true, 'stopped');
      try {
        activeHeartbeat.stop();
        return result(true, 'stopped');
      } catch (_error) {
        return result(false, 'failed');
      }
    }

    return Object.freeze({ start, runHeartbeat, runCommands, stop });
  }

  return Object.freeze({ createFactoryControlRuntime });
});
