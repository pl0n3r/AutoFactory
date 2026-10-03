'use strict';

const assert = require('node:assert/strict');
const protocol = require('./factory-control-protocol.js');
const { createInstanceLedger } = require('./factory-control-ledger.js');
const { createInstanceRuntime } = require('./factory-control-runtime.js');

const NOW = 1_800_000_200_000;
const INSTANCE_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_INSTANCE_ID = '123e4567-e89b-42d3-b456-426614174001';

function command(id, overrides = {}) {
  return {
    version: 2,
    kind: 'command',
    id,
    instanceId: INSTANCE_ID,
    action: 'pause',
    target: 'instance',
    issuedAt: NOW - 1000,
    expiresAt: NOW + 60_000,
    ...overrides
  };
}

function receiptMemory() {
  let rows = [];
  let loads = 0;
  let saves = 0;
  return {
    async load() {
      loads += 1;
      return structuredClone(rows);
    },
    async save(value) {
      saves += 1;
      rows = structuredClone(value);
    },
    counts() {
      return { loads, saves };
    }
  };
}

(async () => {
  const receipts = receiptMemory();
  const ledger = createInstanceLedger({
    instanceId: INSTANCE_ID,
    load: receipts.load,
    save: receipts.save
  });

  let enabled = true;
  let authorizeCalls = 0;
  let deny = false;
  const effects = [];
  const failingTabs = new Set();

  const runtime = createInstanceRuntime({
    protocol,
    authorizer: {
      async authorize(value, context) {
        authorizeCalls += 1;
        if (deny || context.instanceId !== INSTANCE_ID) {
          throw new TypeError('denied');
        }
        assert.deepEqual(context.enabledTabIds, [7, 9]);
        return value;
      }
    },
    ledger,
    instanceStore: {
      async safeSnapshot() {
        return {
          instanceId: INSTANCE_ID,
          browser: 'chrome',
          profileAlias: 'work-profile',
          deviceAlias: 'Felipe Mac',
          extensionVersion: '1.6.15',
          protocolVersion: 2
        };
      }
    },
    listChatTabs: async () => [7, 9],
    sendTab: async (tabId, message) => {
      effects.push(`send:${tabId}:${message.action}:${message.enabled}`);
      if (failingTabs.has(tabId)) throw new Error('private tab detail');
      return { ok: true };
    },
    loadMasterEnabled: async () => enabled,
    saveMasterEnabled: async value => {
      effects.push(`save:${value}`);
      enabled = value;
    },
    now: () => NOW
  });

  assert.deepEqual(await runtime.presence(), {
    version: 2,
    kind: 'presence',
    instanceId: INSTANCE_ID,
    enabled: true,
    tabs: [
      { tabId: 7, enabled: true },
      { tabId: 9, enabled: true }
    ],
    observedAt: NOW
  });

  const beforeWrong = receipts.counts();
  const wrong = await runtime.execute(command('wrong-instance', {
    instanceId: OTHER_INSTANCE_ID
  }));
  assert.deepEqual(wrong, {
    version: 2,
    kind: 'ack',
    id: 'wrong-instance',
    instanceId: OTHER_INSTANCE_ID,
    ok: false,
    code: 'not_found',
    enabled: false,
    appliedTabs: []
  });
  assert.deepEqual(receipts.counts(), beforeWrong);
  assert.deepEqual(effects, []);
  assert.equal(authorizeCalls, 0);

  const pause = command('pause-001');
  const pauseAck = await runtime.execute(pause);
  assert.deepEqual(pauseAck, {
    version: 2,
    kind: 'ack',
    id: 'pause-001',
    instanceId: INSTANCE_ID,
    ok: true,
    code: 'ok',
    enabled: false,
    appliedTabs: [7, 9]
  });
  assert.deepEqual(effects, [
    'save:false',
    'send:7:pause:false',
    'send:9:pause:false'
  ]);
  assert.equal(enabled, false);
  assert.equal(runtime.status().reconciliationPending, false);

  const effectsAfterPause = effects.length;
  const authorizeAfterPause = authorizeCalls;
  assert.deepEqual(await runtime.execute(pause), pauseAck);
  assert.equal(effects.length, effectsAfterPause);
  assert.equal(authorizeCalls, authorizeAfterPause);

  failingTabs.add(9);
  const resume = command('resume-001', { action: 'resume' });
  const failed = await runtime.execute(resume);
  assert.equal(failed.code, 'failed');
  assert.equal(failed.enabled, true);
  assert.deepEqual(failed.appliedTabs, [7]);
  assert.equal(enabled, true);
  assert.equal(runtime.status().reconciliationPending, true);

  const effectsAfterFailure = effects.length;
  const duplicateFailure = await runtime.execute(resume);
  assert.deepEqual(duplicateFailure, failed);
  assert.equal(effects.length, effectsAfterFailure);

  failingTabs.clear();
  const reconciled = await runtime.reconcile();
  assert.deepEqual(reconciled, {
    ok: true,
    code: 'ok',
    enabled: true,
    appliedTabs: [7, 9]
  });
  assert.equal(runtime.status().reconciliationPending, false);

  deny = true;
  const beforeDenied = effects.length;
  const denied = await runtime.execute(command('denied-001'));
  assert.equal(denied.code, 'unauthorized');
  assert.equal(denied.ok, false);
  assert.deepEqual(denied.appliedTabs, []);
  assert.equal(effects.length, beforeDenied);

  assert.doesNotMatch(
    JSON.stringify({ effects, pauseAck, failed, reconciled, denied }),
    /chat text|https?:|@example|cookie|token|private tab detail/i
  );

  console.log('Factory instance runtime: persistence precedes fan-out and wrong-instance is effect-free');
  console.log('Factory instance runtime: duplicates, partial failure and reconcile are fail-closed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
