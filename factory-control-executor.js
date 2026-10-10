(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryExecutor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACTIONS = Object.freeze([
    'pause', 'resume', 'open_chat', 'set_prompt', 'set_mode', 'send_message'
  ]);

  function exactKeys(value, fields) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every(field => Object.hasOwn(value, field));
  }

  function samePayload(expected, actual) {
    if (expected === null || actual === null) return expected === actual;
    if (!exactKeys(expected, Object.keys(expected)) ||
        !exactKeys(actual, Object.keys(expected))) return false;
    return Object.keys(expected).every(key => actual[key] === expected[key]);
  }

  function sameCommand(expected, actual) {
    const fields = ['version', 'kind', 'id', 'action', 'target', 'payload'];
    return exactKeys(expected, fields) && exactKeys(actual, fields) &&
      expected.version === actual.version &&
      expected.kind === actual.kind &&
      expected.id === actual.id &&
      expected.action === actual.action &&
      expected.target === actual.target &&
      samePayload(expected.payload, actual.payload);
  }

  function effectCommand(command) {
    const payload = command.payload === null
      ? null
      : Object.freeze({ ...command.payload });
    return Object.freeze({
      version: command.version,
      kind: command.kind,
      id: command.id,
      action: command.action,
      target: command.target,
      payload
    });
  }

  function checkedEffects(effects) {
    if (!effects || typeof effects !== 'object' || Array.isArray(effects) ||
        Object.keys(effects).length !== ACTIONS.length ||
        !ACTIONS.every(action => Object.hasOwn(effects, action) &&
          typeof effects[action] === 'function')) {
      throw new TypeError('All six command effect handlers are required');
    }
    return effects;
  }

  function createCommandExecutor({ ledger, authorizer, effects, auditStore } = {}) {
    if (!ledger || typeof ledger.execute !== 'function' ||
        typeof ledger.deferOutcome !== 'function' ||
        !authorizer || typeof authorizer.authorize !== 'function' ||
        !auditStore || typeof auditStore.append !== 'function') {
      throw new TypeError('Ledger, authorizer and audit adapter are required');
    }
    const handlers = checkedEffects(effects);

    async function record(phase, outcome) {
      // Never record IDs, targets, aliases, command payloads or adapter errors.
      const event = Object.freeze({
        event: 'command_execution', phase, outcome
      });
      try {
        return await auditStore.append(event) === true;
      } catch (_error) {
        return false;
      }
    }

    async function execute(input, context) {
      return ledger.execute(input, async command => {
        let approved = null;
        try {
          approved = await authorizer.authorize({
            id: command.id,
            action: command.action,
            target: command.target,
            payload: command.payload === null ? null : { ...command.payload }
          }, context);
        } catch (_error) {
          // Errors are denials. Never expose grant or adapter details.
        }

        const authorized = sameCommand(command, approved);
        if (!await record('decision', authorized ? 'authorized' : 'unauthorized')) {
          // No audit of the decision: no external effect.
          return { ok: false, code: 'failed' };
        }
        if (!authorized) {
          if (!await record('result', 'unauthorized')) return ledger.deferOutcome();
          return { ok: false, code: 'unauthorized' };
        }

        let result;
        try {
          // This is the only place where a command can cause an effect.
          result = await handlers[command.action](effectCommand(command));
        } catch (_error) {
          result = { ok: false, code: 'failed' };
        }
        const outcome = result?.ok === true && result?.code === 'ok'
          ? 'ok' : 'failed';
        if (!await record('result', outcome)) {
          // Effect may have happened. The ledger retains pending and rejects
          // a replay even when the fake audit adapter is recreated.
          return ledger.deferOutcome();
        }
        return result;
      });
    }

    return Object.freeze({ execute });
  }

  return Object.freeze({ ACTIONS, createCommandExecutor });
});
