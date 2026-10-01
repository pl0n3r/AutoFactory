{
  'use strict';

  function safeReasoning(value) {
    return ['high', 'medium', 'low'].includes(value) ? value : 'unknown';
  }

  (function (root, factory) {
    const api = factory(
      typeof module === 'object' && module.exports
        ? require('./account-budget.js')
        : root.ChatGPTAutopilotAccountBudget
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ChatGPTAutopilotAccountBudgetBackground = api;
  })(typeof globalThis !== 'undefined' ? globalThis : this, function (budget) {
    const SETTINGS = Object.freeze({
      accountBudgetAccountAlias: budget.DEFAULT_ACCOUNT_ALIAS,
      accountBudgetLimit: budget.DEFAULT_LIMIT,
      accountBudgetWindowMinutes: budget.DEFAULT_WINDOW_MS / 60000
    });

    function createController({ storage, now = Date.now } = {}) {
      if (!budget || typeof budget.consume !== 'function' ||
          typeof budget.refresh !== 'function' ||
          !storage || typeof storage.get !== 'function' || typeof storage.set !== 'function' ||
          typeof now !== 'function') {
        throw new TypeError('Account budget controller dependencies are required');
      }
      let queue = Promise.resolve();

      async function context() {
        const defaults = {
          [budget.STATE_KEY]: {},
          [budget.FACTORY_POLICY_KEY]: null,
          ...SETTINGS
        };
        const values = await storage.get(defaults);
        if (!values || typeof values !== 'object' || Array.isArray(values)) {
          throw new TypeError('Invalid account budget storage response');
        }
        const alias = budget.accountAlias(
          values.accountBudgetAccountAlias || budget.DEFAULT_ACCOUNT_ALIAS
        );
        const policy = budget.effectivePolicy(
          values, values[budget.FACTORY_POLICY_KEY], alias
        );
        const state = budget.normalizeState(values[budget.STATE_KEY] || {});
        return { alias, policy, state };
      }

      async function persist(result) {
        await storage.set({
          [budget.STATE_KEY]: result.state,
          [budget.SNAPSHOT_KEY]: result.snapshot
        });
        return result;
      }

      function serial(operation) {
        const run = queue.then(operation, operation);
        queue = run.catch(() => {});
        return run;
      }

      return Object.freeze({
        status() {
          return serial(async () => {
            const current = await context();
            const result = budget.refresh(
              current.state, current.alias, current.policy, now()
            );
            await persist(result);
            return { snapshot: result.snapshot };
          });
        },

        consume(input = {}) {
          return serial(async () => {
            const current = await context();
            const result = budget.consume(current.state, {
              accountAlias: current.alias,
              now: now(),
              policy: current.policy,
              reasoningLevel: safeReasoning(input.reasoningLevel)
            });
            await persist(result);
            return { allowed: result.allowed, snapshot: result.snapshot };
          });
        },

        recordLimit(input = {}) {
          return serial(async () => {
            const current = await context();
            const resetAt = input.resetAt === null || input.resetAt === undefined
              ? null : input.resetAt;
            const result = budget.recordLimit(current.state, {
              accountAlias: current.alias,
              now: now(),
              policy: current.policy,
              reasoningLevel: safeReasoning(input.reasoningLevel),
              resetAt
            });
            await persist(result);
            return { snapshot: result.snapshot };
          });
        }
      });
    }

    function browserStorage(extensionApi) {
      const local = extensionApi?.storage?.local;
      if (!local || typeof local.get !== 'function' || typeof local.set !== 'function') {
        throw new TypeError('Account budget storage unavailable');
      }
      return Object.freeze({
        get(defaults) {
          return new Promise((resolve, reject) => {
            try {
              const result = local.get(defaults, resolve);
              if (typeof result?.then === 'function') result.then(resolve, reject);
            } catch (error) {
              reject(error);
            }
          });
        },
        set(values) {
          return new Promise((resolve, reject) => {
            try {
              const result = local.set(values, resolve);
              if (typeof result?.then === 'function') result.then(resolve, reject);
            } catch (error) {
              reject(error);
            }
          });
        }
      });
    }

    function install(extensionApi, now = Date.now) {
      if (!extensionApi?.runtime?.onMessage?.addListener) {
        throw new TypeError('Account budget runtime unavailable');
      }
      const controller = createController({ storage: browserStorage(extensionApi), now });
      extensionApi.runtime.onMessage.addListener((message, _sender, reply) => {
        let operation = null;
        if (message?.type === 'autopilot:budget-status') {
          operation = controller.status();
        } else if (message?.type === 'autopilot:budget-consume') {
          operation = controller.consume({ reasoningLevel: message.reasoningLevel });
        } else if (message?.type === 'autopilot:budget-limit') {
          operation = controller.recordLimit({
            reasoningLevel: message.reasoningLevel,
            resetAt: Number.isSafeInteger(message.resetAt) && message.resetAt > 0
              ? message.resetAt : null
          });
        }
        if (operation === null) return undefined;
        operation.then(result => reply({ ok: true, ...result }))
          .catch(() => reply({ ok: false }));
        return true;
      });
      controller.status().catch(() => {});
      return controller;
    }

    return Object.freeze({ SETTINGS, createController, browserStorage, install });
  });
}
