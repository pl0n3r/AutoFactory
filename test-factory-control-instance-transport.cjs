'use strict';

const assert = require('node:assert/strict');
const {
  MAX_FRAME_BYTES,
  MAX_RETRY_MS,
  createLocalAgentTransportBoundary
} = require('./factory-control-instance-transport.js');

const command = Object.freeze({
  version: 2,
  kind: 'command',
  id: 'command-local-1',
  instanceId: '11111111-1111-4111-8111-111111111111',
  action: 'pause',
  target: 'instance',
  issuedAt: 1_000,
  expiresAt: 61_000
});
const okReceipt = Object.freeze({
  version: 2,
  kind: 'ack',
  id: command.id,
  instanceId: command.instanceId,
  ok: true,
  code: 'ok',
  enabled: false,
  appliedTabs: [7, 9]
});
const deniedReceipt = Object.freeze({
  version: 2,
  kind: 'ack',
  id: command.id,
  instanceId: command.instanceId,
  ok: false,
  code: 'unauthorized',
  enabled: true,
  appliedTabs: []
});

function harness({ execute = async () => okReceipt, connectPlan = [] } = {}) {
  let hooks = null;
  const hookHistory = [];
  let effects = 0;
  let now = 5_000;
  const scheduled = [];
  let connectCalls = 0;
  const runtime = {
    async execute(value) {
      effects += 1;
      return execute(value);
    }
  };
  const boundary = createLocalAgentTransportBoundary({
    async connect(callbacks) {
      hooks = callbacks;
      hookHistory.push(callbacks);
      const plan = connectPlan[connectCalls++];
      if (plan instanceof Error) throw plan;
      return {
        async close() {}
      };
    },
    instanceStore: {
      async safeSnapshot() {
        return Object.freeze({
          instanceId: command.instanceId,
          browser: 'chrome',
          profileAlias: 'perfil-local',
          deviceAlias: 'mac-local',
          extensionVersion: '1.6.15',
          protocolVersion: 2
        });
      }
    },
    runtime,
    clock: () => now++,
    schedule(callback, delay) {
      const token = { callback, delay, cancelled: false };
      scheduled.push(token);
      return token;
    },
    cancelSchedule(token) {
      token.cancelled = true;
    }
  });
  return {
    boundary,
    get hooks() { return hooks; },
    hookHistory,
    scheduled,
    effects: () => effects
  };
}

(async () => {
  {
    const h = harness();
    await h.boundary.start();

    assert.deepEqual(
      await h.hooks.onFrame(
        { version: 2, kind: 'command', command },
        { authenticated: false }
      ),
      { ok: false, code: 'unauthorized' }
    );
    assert.equal(h.effects(), 0);

    assert.deepEqual(
      await h.hooks.onFrame(
        { version: 2, kind: 'command', command, authenticated: true },
        { authenticated: true }
      ),
      { ok: false, code: 'invalid' }
    );
    assert.equal(h.effects(), 0);

    const oversized = {
      version: 2,
      kind: 'command',
      command: { ...command, padding: 'x'.repeat(MAX_FRAME_BYTES) }
    };
    assert.deepEqual(
      await h.hooks.onFrame(oversized, { authenticated: true }),
      { ok: false, code: 'invalid' }
    );
    assert.equal(h.effects(), 0);
  }

  {
    const h = harness();
    await h.boundary.start();
    assert.deepEqual(
      await h.hooks.onFrame(
        { version: 2, kind: 'command', command },
        { authenticated: true }
      ),
      okReceipt
    );
    assert.equal(h.effects(), 1);

    const revoked = harness({ execute: async () => deniedReceipt });
    await revoked.boundary.start();
    assert.deepEqual(
      await revoked.hooks.onFrame(
        { version: 2, kind: 'command', command },
        { authenticated: true }
      ),
      deniedReceipt
    );
    assert.equal(revoked.effects(), 1);
  }

  {
    const h = harness({ connectPlan: [null, new Error('offline'), new Error('offline')] });
    const first = await h.boundary.start();
    assert.equal(first.state, 'connected');

    await h.hooks.onClose();
    assert.equal(h.boundary.status().state, 'backoff');
    assert.equal(h.boundary.status().nextRetryMs, 1_000);

    await h.scheduled.at(-1).callback();
    assert.equal(h.boundary.status().state, 'backoff');
    assert.equal(h.boundary.status().nextRetryMs, 2_000);

    for (let index = 0; index < 8; index++) {
      const latest = h.scheduled.at(-1);
      if (!latest || latest.cancelled) break;
      await latest.callback();
      if (h.boundary.status().state !== 'backoff') break;
    }
    assert.ok(h.boundary.status().nextRetryMs <= MAX_RETRY_MS);

    const serialized = JSON.stringify(h.boundary.status());
    for (const forbidden of [
      command.instanceId, 'perfil-local', 'mac-local', command.id, 'pause', 'receipt', 'changedAt'
    ]) assert.equal(serialized.includes(forbidden), false);

    await h.boundary.stop();
    assert.equal(h.boundary.status().state, 'stopped');
  }


  {
    const h = harness({ connectPlan: [null, null] });
    await h.boundary.start();
    const stale = h.hooks;
    await stale.onClose();
    await h.scheduled.at(-1).callback();
    assert.equal(h.boundary.status().state, 'connected');
    const scheduledBefore = h.scheduled.length;
    await stale.onClose();
    assert.equal(h.boundary.status().state, 'connected');
    assert.equal(h.scheduled.length, scheduledBefore);
  }

  console.log('factory-control local-agent transport boundary: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
