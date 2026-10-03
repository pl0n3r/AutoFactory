'use strict';

const assert = require('node:assert/strict');
const { createFactoryControlRuntime } = require('./factory-control-runtime.js');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function happyPath() {
  const profiles = [];
  const stops = [];
  const pumpInputs = [];
  let pumpCall = 0;

  const runtime = createFactoryControlRuntime({
    createHeartbeat: ({ profileAlias }) => {
      profiles.push(profileAlias);
      return Object.freeze({
        tick: async () => 'sent',
        stop: () => { stops.push(profileAlias); }
      });
    },
    loadContext: async ({ profileAlias }) => ({
      profileAlias,
      enabledTabIds: [7, 9]
    }),
    pump: {
      runOnce: async input => {
        pumpInputs.push(input);
        pumpCall += 1;
        if (pumpCall === 1) {
          return { ok: true, code: 'empty', cursor: 'cursor:002' };
        }
        return {
          ok: true,
          code: 'handled',
          cursor: 'cursor:003',
          commandId: 'command-003',
          outcome: 'ok'
        };
      }
    }
  });

  assert.deepEqual(
    runtime.start({ profileAlias: 'perfil-1', cursor: 'cursor:001' }),
    { ok: true, code: 'started' }
  );
  assert.deepEqual(profiles, ['perfil-1']);
  assert.deepEqual(await runtime.runHeartbeat(), { ok: true, code: 'sent' });

  assert.deepEqual(
    await runtime.runCommands(),
    { ok: true, code: 'empty', cursor: 'cursor:002' }
  );
  assert.equal(pumpInputs[0].cursor, 'cursor:001');
  assert.deepEqual(
    pumpInputs[0].context,
    { profileAlias: 'perfil-1', enabledTabIds: [7, 9] }
  );
  assert.equal(Object.isFrozen(pumpInputs[0]), true);
  assert.equal(Object.isFrozen(pumpInputs[0].context), true);
  assert.equal(Object.isFrozen(pumpInputs[0].context.enabledTabIds), true);

  assert.deepEqual(
    await runtime.runCommands(),
    { ok: true, code: 'handled', cursor: 'cursor:003' }
  );
  assert.equal(pumpInputs[1].cursor, 'cursor:002');

  assert.deepEqual(runtime.stop(), { ok: true, code: 'stopped' });
  assert.deepEqual(stops, ['perfil-1']);
  assert.deepEqual(await runtime.runHeartbeat(), { ok: false, code: 'stopped' });
  assert.deepEqual(await runtime.runCommands(), { ok: false, code: 'stopped' });

  assert.deepEqual(
    runtime.start({ profileAlias: 'perfil-2', cursor: null }),
    { ok: true, code: 'started' }
  );
  assert.deepEqual(profiles, ['perfil-1', 'perfil-2']);
  runtime.stop();

  assert.deepEqual(
    runtime.start({ profileAlias: 'person@example.test', cursor: null }),
    { ok: false, code: 'invalid' }
  );

  const hidden = { profileAlias: 'perfil-3', cursor: null };
  Object.defineProperty(hidden, 'extra', { value: 'x', enumerable: false });
  assert.deepEqual(runtime.start(hidden), { ok: false, code: 'invalid' });
}

async function failClosed() {
  let pumpCalls = 0;
  const driftRuntime = createFactoryControlRuntime({
    createHeartbeat: () => ({ tick: async () => 'sent', stop() {} }),
    loadContext: async () => ({ profileAlias: 'otro-perfil', enabledTabIds: [7] }),
    pump: {
      runOnce: async () => {
        pumpCalls += 1;
        return { ok: true, code: 'empty', cursor: null };
      }
    }
  });
  driftRuntime.start({ profileAlias: 'perfil-1', cursor: 'cursor:001' });
  assert.deepEqual(
    await driftRuntime.runCommands(),
    { ok: false, code: 'failed', cursor: 'cursor:001' }
  );
  assert.equal(pumpCalls, 0);
  driftRuntime.stop();

  const contextGate = deferred();
  let staleContextPumpCalls = 0;
  const staleContextRuntime = createFactoryControlRuntime({
    createHeartbeat: () => ({ tick: async () => 'sent', stop() {} }),
    loadContext: async ({ profileAlias }) => {
      await contextGate.promise;
      return { profileAlias, enabledTabIds: [7] };
    },
    pump: {
      runOnce: async () => {
        staleContextPumpCalls += 1;
        return { ok: true, code: 'empty', cursor: 'cursor:next' };
      }
    }
  });
  staleContextRuntime.start({ profileAlias: 'perfil-1', cursor: 'cursor:before' });
  const pendingContext = staleContextRuntime.runCommands();
  staleContextRuntime.stop();
  contextGate.resolve();
  assert.deepEqual(await pendingContext, { ok: false, code: 'stopped' });
  assert.equal(staleContextPumpCalls, 0);

  const pumpGate = deferred();
  const seen = [];
  const stalePumpRuntime = createFactoryControlRuntime({
    createHeartbeat: () => ({ tick: async () => 'sent', stop() {} }),
    loadContext: async ({ profileAlias }) => ({ profileAlias, enabledTabIds: [7] }),
    pump: {
      runOnce: async input => {
        seen.push(input.cursor);
        await pumpGate.promise;
        return {
          ok: true,
          code: 'handled',
          cursor: 'cursor:stale',
          commandId: 'command-stale',
          outcome: 'ok'
        };
      }
    }
  });
  stalePumpRuntime.start({ profileAlias: 'perfil-1', cursor: 'cursor:before' });
  const pendingPump = stalePumpRuntime.runCommands();
  // Let the resolved context continuation enter pump.runOnce before stopping.
  await Promise.resolve();
  stalePumpRuntime.stop();
  assert.deepEqual(
    stalePumpRuntime.start({ profileAlias: 'perfil-2', cursor: 'cursor:fresh' }),
    { ok: false, code: 'busy' }
  );
  pumpGate.resolve();
  assert.deepEqual(await pendingPump, { ok: false, code: 'stopped' });
  assert.deepEqual(seen, ['cursor:before']);
  assert.deepEqual(
    stalePumpRuntime.start({ profileAlias: 'perfil-2', cursor: 'cursor:fresh' }),
    { ok: true, code: 'started' }
  );
  stalePumpRuntime.stop();

  const throwRuntime = createFactoryControlRuntime({
    createHeartbeat: () => ({ tick: async () => 'sent', stop() {} }),
    loadContext: async () => { throw new Error('adapter failure detail'); },
    pump: { runOnce: async () => { throw new Error('must not run'); } }
  });
  throwRuntime.start({ profileAlias: 'perfil-1', cursor: null });
  assert.deepEqual(
    await throwRuntime.runCommands(),
    { ok: false, code: 'failed', cursor: null }
  );
  throwRuntime.stop();

  const malformedRuntime = createFactoryControlRuntime({
    createHeartbeat: () => ({ tick: async () => 'sent', stop() {} }),
    loadContext: async ({ profileAlias }) => ({ profileAlias, enabledTabIds: [7] }),
    pump: {
      runOnce: async () => ({
        ok: true,
        code: 'handled',
        cursor: 'cursor:2',
        commandId: 'command-2',
        outcome: 'ok',
        extra: true
      })
    }
  });
  malformedRuntime.start({ profileAlias: 'perfil-1', cursor: 'cursor:1' });
  assert.deepEqual(
    await malformedRuntime.runCommands(),
    { ok: false, code: 'failed', cursor: 'cursor:1' }
  );
  malformedRuntime.stop();

  const invalidOutcomeRuntime = createFactoryControlRuntime({
    createHeartbeat: () => ({ tick: async () => 'sent', stop() {} }),
    loadContext: async ({ profileAlias }) => ({ profileAlias, enabledTabIds: [7] }),
    pump: {
      runOnce: async () => ({
        ok: true,
        code: 'handled',
        cursor: 'cursor:2',
        commandId: 'command-2',
        outcome: 'unexpected'
      })
    }
  });
  invalidOutcomeRuntime.start({ profileAlias: 'perfil-1', cursor: 'cursor:1' });
  assert.deepEqual(
    await invalidOutcomeRuntime.runCommands(),
    { ok: false, code: 'failed', cursor: 'cursor:1' }
  );
  invalidOutcomeRuntime.stop();

  const tabsRuntime = createFactoryControlRuntime({
    createHeartbeat: () => ({ tick: async () => 'sent', stop() {} }),
    loadContext: async ({ profileAlias }) => {
      const enabledTabIds = [7];
      enabledTabIds[Symbol('extra')] = 9;
      return { profileAlias, enabledTabIds };
    },
    pump: { runOnce: async () => { throw new Error('must not run'); } }
  });
  tabsRuntime.start({ profileAlias: 'perfil-1', cursor: null });
  assert.deepEqual(
    await tabsRuntime.runCommands(),
    { ok: false, code: 'failed', cursor: null }
  );
  tabsRuntime.stop();
}

(async () => {
  const mode = process.argv[2] || 'all';
  if (!['all', 'happy', 'failclosed'].includes(mode)) {
    throw new Error('unknown test mode');
  }
  if (mode === 'all' || mode === 'happy') await happyPath();
  if (mode === 'all' || mode === 'failclosed') await failClosed();
  console.log('factory-control runtime lifecycle: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
