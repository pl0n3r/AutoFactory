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

  function createCommandExecutor({ ledger, authorizer, effects } = {}) {
    if (!ledger || typeof ledger.execute !== 'function' ||
        !authorizer || typeof authorizer.authorize !== 'function') {
      throw new TypeError('Ledger and command authorizer are required');
    }
    const handlers = checkedEffects(effects);

    async function execute(input, context) {
      return ledger.execute(input, async command => {
        let approved;
        try {
          approved = await authorizer.authorize({
            id: command.id,
            action: command.action,
            target: command.target,
            payload: command.payload
          }, context);
        } catch (_error) {
          // Persist unauthorized as a terminal receipt so the same command ID
          // cannot become executable later merely because a grant changes.
          return { ok: false, code: 'unauthorized' };
        }
        if (!sameCommand(command, approved)) {
          return { ok: false, code: 'unauthorized' };
        }
        // Effects receive a frozen copy. They cannot mutate the ledger command,
        // and arbitrary adapter exceptions are collapsed by the ledger to failed.
        return handlers[command.action](effectCommand(command));
      });
    }

    return Object.freeze({ execute });
  }

  return Object.freeze({ ACTIONS, createCommandExecutor });
});
