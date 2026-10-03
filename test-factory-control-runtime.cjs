'use strict';

const assert = require('node:assert/strict');
const { createFactoryControlRuntime, createInstanceRuntime } = require('./factory-control-runtime.js');
const protocol = require('./factory-control-protocol.js');
const { createInstanceCommandAuthorizer } = require('./factory-control-authorization.js');
const { createInstanceLedger } = require('./factory-control-ledger.js');

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


const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_INSTANCE_ID = '22222222-2222-4222-8222-222222222222';

function instanceCommand(id, action, instanceId = INSTANCE_ID, issuedAt = 900, expiresAt = 1100) {
  return {
    version: 2, kind: 'command', id, instanceId,
    action, target: 'instance', issuedAt, expiresAt
  };
}

function instanceHarness() {
  let receipts = [];
  let masterEnabled = true;
  let now = 1000;
  let grantExpiresAt = 2000;
  let grantRevoked = false;
  let failedTab = null;
  let masterLoadFails = false;
  const sends = [];
  const saves = [];

  const instanceStore = {
    safeSnapshot: async () => Object.freeze({
      instanceId: INSTANCE_ID,
      browser: 'chrome',
      profileAlias: 'perfil-1',
      deviceAlias: 'mac-local',
      extensionVersion: '1.6.15',
      protocolVersion: 2
    })
  };

  function buildRuntime() {
    const authorizer = createInstanceCommandAuthorizer({
      loadVerifiedGrant: async () => ({
        instanceId: INSTANCE_ID,
        expiresAt: grantExpiresAt,
        revoked: grantRevoked,
        actions: ['pause', 'resume'],
        tabIds: [7, 9]
      }),
      now: () => now
    });
    const ledger = createInstanceLedger({
      instanceId: INSTANCE_ID,
      load: async () => structuredClone(receipts),
      save: async value => { receipts = structuredClone(value); }
    });
    return createInstanceRuntime({
      protocol,
      authorizer,
      ledger,
      instanceStore,
      listChatTabs: async () => [7, 9],
      sendTab: async (tabId, message) => {
        sends.push({ tabId, message, masterEnabled });
        return { ok: tabId !== failedTab };
      },
      loadMasterEnabled: async () => {
        if (masterLoadFails) throw new Error('private master-state detail');
        return masterEnabled;
      },
      saveMasterEnabled: async enabled => {
        masterEnabled = enabled;
        saves.push(enabled);
      },
      now: () => now
    });
  }

  return {
    buildRuntime,
    sends,
    saves,
    get masterEnabled() { return masterEnabled; },
    setFailedTab(value) { failedTab = value; },
    setMasterLoadFails(value) { masterLoadFails = value; },
    setRevoked(value) { grantRevoked = value; },
    setNow(value) { now = value; },
    setGrantExpiresAt(value) { grantExpiresAt = value; }
  };
}

async function instanceHappyPath() {
  const harness = instanceHarness();
  let runtime = harness.buildRuntime();
  const pause = instanceCommand('instance-command-1', 'pause');
  const ack = await runtime.execute(pause);
  assert.equal(ack.ok, true);
  assert.equal(ack.code, 'ok');
  assert.equal(ack.enabled, false);
  assert.deepEqual(ack.appliedTabs, [7, 9]);
  assert.deepEqual(harness.saves, [false]);
  assert.equal(harness.sends.every(item => item.masterEnabled === false), true);

  const sendsBeforeDuplicate = harness.sends.length;
  runtime = harness.buildRuntime();
  const duplicate = await runtime.execute(pause);
  assert.deepEqual(duplicate, ack);
  assert.equal(harness.sends.length, sendsBeforeDuplicate);
  assert.deepEqual(runtime.status(), { reconciliationPending: false });
  console.log('factory-control instance runtime: duplicate receipt does not reapply after status repair');

  harness.setFailedTab(9);
  const partial = await runtime.execute(instanceCommand('instance-command-2', 'resume'));
  assert.equal(partial.ok, false);
  assert.equal(partial.code, 'failed');
  assert.equal(partial.enabled, true);
  assert.deepEqual(partial.appliedTabs, [7]);
  assert.equal(harness.masterEnabled, true);

  console.log('factory-control instance runtime: persist-before-fanout and duplicate-safe');
}

async function instanceFailClosed() {
  const harness = instanceHarness();
  const runtime = harness.buildRuntime();

  const wrong = await runtime.execute(
    instanceCommand('instance-command-wrong', 'pause', OTHER_INSTANCE_ID)
  );
  assert.equal(wrong.code, 'not_found');
  assert.equal(harness.sends.length, 0);
  assert.equal(harness.saves.length, 0);
  assert.deepEqual(runtime.status(), { reconciliationPending: false });
  console.log('factory-control instance runtime: wrong instance returns not_found with zero effects');

  harness.setRevoked(true);
  const revoked = await runtime.execute(instanceCommand('instance-command-revoked', 'pause'));
  assert.equal(revoked.code, 'unauthorized');
  assert.equal(harness.sends.length, 0);

  harness.setRevoked(false);
  harness.setNow(3000);
  harness.setGrantExpiresAt(2500);
  const expired = await runtime.execute(
    instanceCommand('instance-command-expired', 'pause', INSTANCE_ID, 2900, 3100)
  );
  assert.equal(expired.code, 'unauthorized');
  assert.equal(harness.sends.length, 0);

  console.log('factory-control instance runtime: wrong-instance revoked and expired fail closed');
}

async function instanceReconcile() {
  const harness = instanceHarness();
  let runtime = harness.buildRuntime();
  await runtime.execute(instanceCommand('instance-command-pause', 'pause'));
  harness.setFailedTab(9);
  const failed = await runtime.execute(instanceCommand('instance-command-resume', 'resume'));
  assert.equal(failed.code, 'failed');
  assert.deepEqual(runtime.status(), { reconciliationPending: true });

  harness.setFailedTab(null);
  const reconciled = await runtime.reconcile();
  assert.deepEqual(reconciled, {
    ok: true, code: 'ok', enabled: true, appliedTabs: [7, 9]
  });
  assert.deepEqual(runtime.status(), { reconciliationPending: false });

  harness.setMasterLoadFails(true);
  const failedAfterKnownState = await runtime.reconcile();
  assert.deepEqual(failedAfterKnownState, {
    ok: false, code: 'failed', enabled: true, appliedTabs: []
  });
  assert.deepEqual(runtime.status(), { reconciliationPending: true });

  const unknownHarness = instanceHarness();
  unknownHarness.setMasterLoadFails(true);
  const unknownRuntime = unknownHarness.buildRuntime();
  const failedWithoutKnownState = await unknownRuntime.reconcile();
  assert.deepEqual(failedWithoutKnownState, {
    ok: false, code: 'failed', enabled: null, appliedTabs: []
  });
  assert.deepEqual(unknownRuntime.status(), { reconciliationPending: true });

  harness.setMasterLoadFails(false);
  console.log('factory-control instance runtime: reconcile preserves known state and never guesses unknown state');
  console.log('factory-control instance runtime: partial failure sets reconciliation pending until full reconcile');
  const presence = await runtime.presence();
  assert.equal(presence.instanceId, INSTANCE_ID);
  assert.equal(presence.enabled, true);
  assert.deepEqual(presence.tabs, [
    { tabId: 7, enabled: true },
    { tabId: 9, enabled: true }
  ]);

  console.log('factory-control instance runtime: reconcile follows local master state');
}

(async () => {
  const mode = process.argv[2] || 'all';
  if (!['all', 'happy', 'failclosed', 'instance-happy', 'instance-failclosed', 'instance-reconcile'].includes(mode)) {
    throw new Error('unknown test mode');
  }
  if (mode === 'all' || mode === 'happy') await happyPath();
  if (mode === 'all' || mode === 'failclosed') await failClosed();
  if (mode === 'all' || mode === 'instance-happy') await instanceHappyPath();
  if (mode === 'all' || mode === 'instance-failclosed') await instanceFailClosed();
  if (mode === 'all' || mode === 'instance-reconcile') await instanceReconcile();
  console.log('factory-control runtime lifecycle: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
