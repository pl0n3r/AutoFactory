'use strict';

const assert = require('node:assert/strict');
const { createLedger } = require('./factory-control-ledger.js');
const { createCommandAuthorizer } = require('./factory-control-authorization.js');
const { ACTIONS, createCommandExecutor } = require('./factory-control-executor.js');

function memoryStore() {
  let receipts = [];
  return {
    load: async () => structuredClone(receipts),
    save: async value => { receipts = structuredClone(value); },
    snapshot: () => JSON.stringify(receipts)
  };
}

function command(id, action = 'send_message', target = 7, payload = undefined) {
  const value = { id, action, target };
  if (payload !== undefined) value.payload = payload;
  return value;
}

function effects(spy) {
  return Object.fromEntries(ACTIONS.map(action => [action, async value => {
    spy.push({ action, value });
    return { ok: true, code: 'ok' };
  }]));
}

(async () => {
  let now = 1000;
  let grant = {
    profileAlias: 'profile-one',
    expiresAt: 10000,
    revoked: false,
    actions: [...ACTIONS],
    tabIds: [7],
    broadcast: true
  };
  const context = { profileAlias: 'profile-one', enabledTabIds: [7] };
  const authorizer = createCommandAuthorizer({
    loadVerifiedGrant: async () => structuredClone(grant),
    now: () => now
  });
  const store = memoryStore();
  const calls = [];
  const executor = createCommandExecutor({
    ledger: createLedger(store),
    authorizer,
    effects: effects(calls)
  });

  const privateText = 'private chat text must never enter receipts or ACKs';
  const first = await executor.execute(
    command('send-once', 'send_message', 7, { text: privateText }),
    context
  );
  assert.deepEqual(first, {
    version: 1, kind: 'ack', id: 'send-once', ok: true, code: 'ok'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'send_message');
  assert.equal(calls[0].value.payload.text, privateText);
  assert.equal(Object.isFrozen(calls[0].value), true);
  assert.equal(Object.isFrozen(calls[0].value.payload), true);
  assert.doesNotMatch(store.snapshot(), /private chat text|payload|profile-one/);

  const duplicate = await executor.execute(
    command('send-once', 'send_message', 7, { text: privateText }),
    context
  );
  assert.equal(duplicate.code, 'already_handled');
  assert.equal(calls.length, 1);

  const deniedStore = memoryStore();
  const deniedCalls = [];
  grant.actions = ['pause'];
  const deniedExecutor = createCommandExecutor({
    ledger: createLedger(deniedStore),
    authorizer,
    effects: effects(deniedCalls)
  });
  const denied = await deniedExecutor.execute(
    command('denied-once', 'send_message', 7, { text: privateText }),
    context
  );
  assert.deepEqual(denied, {
    version: 1, kind: 'ack', id: 'denied-once', ok: false, code: 'unauthorized'
  });
  assert.equal(deniedCalls.length, 0);
  grant.actions = [...ACTIONS];
  assert.equal((await deniedExecutor.execute(
    command('denied-once', 'send_message', 7, { text: privateText }),
    context
  )).code, 'already_handled');
  assert.equal(deniedCalls.length, 0);

  const broadcastCalls = [];
  const broadcastExecutor = createCommandExecutor({
    ledger: createLedger(memoryStore()),
    authorizer,
    effects: effects(broadcastCalls)
  });
  assert.equal((await broadcastExecutor.execute(
    command('pause-all', 'pause', 'all'),
    context
  )).code, 'ok');
  assert.equal(broadcastCalls[0].value.target, 'all');
  await assert.rejects(
    broadcastExecutor.execute(
      command('send-all', 'send_message', 'all', { text: privateText }),
      context
    ),
    /Broadcast is restricted/
  );
  assert.equal(broadcastCalls.length, 1);

  const failureStore = memoryStore();
  const secretEffects = effects([]);
  secretEffects.send_message = async () => {
    throw new Error('private-token-should-never-leak');
  };
  const failureExecutor = createCommandExecutor({
    ledger: createLedger(failureStore),
    authorizer,
    effects: secretEffects
  });
  const failed = await failureExecutor.execute(
    command('effect-fails', 'send_message', 7, { text: privateText }),
    context
  );
  assert.deepEqual(failed, {
    version: 1, kind: 'ack', id: 'effect-fails', ok: false, code: 'failed'
  });
  assert.doesNotMatch(JSON.stringify(failed) + failureStore.snapshot(),
    /private-token|private chat text/);

  const invalidOutcomeEffects = effects([]);
  invalidOutcomeEffects.pause = async () => ({
    ok: true, code: 'failed', detail: 'private diagnostic'
  });
  const invalidOutcome = await createCommandExecutor({
    ledger: createLedger(memoryStore()),
    authorizer,
    effects: invalidOutcomeEffects
  }).execute(command('invalid-outcome', 'pause', 7), context);
  assert.equal(invalidOutcome.code, 'failed');
  assert.equal(JSON.stringify(invalidOutcome).includes('private diagnostic'), false);

  const tamperedCalls = [];
  const tampered = await createCommandExecutor({
    ledger: createLedger(memoryStore()),
    authorizer: {
      authorize: async input => ({
        version: 1,
        kind: 'command',
        id: input.id,
        action: input.action,
        target: 8,
        payload: input.payload ?? null
      })
    },
    effects: effects(tamperedCalls)
  }).execute(command('tampered-target', 'pause', 7), context);
  assert.equal(tampered.code, 'unauthorized');
  assert.equal(tamperedCalls.length, 0);

  assert.throws(() => createCommandExecutor({}), /required/);
  const incomplete = effects([]);
  delete incomplete.open_chat;
  assert.throws(() => createCommandExecutor({
    ledger: createLedger(memoryStore()),
    authorizer,
    effects: incomplete
  }), /six command effect handlers/);

  now = 10001;
  const expiredCalls = [];
  const expired = await createCommandExecutor({
    ledger: createLedger(memoryStore()),
    authorizer,
    effects: effects(expiredCalls)
  }).execute(command('expired-grant', 'pause', 7), context);
  assert.equal(expired.code, 'unauthorized');
  assert.equal(expiredCalls.length, 0);

  console.log('Factory Control executor: authorization, durable idempotency, effect isolation and safe ACKs pass');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
