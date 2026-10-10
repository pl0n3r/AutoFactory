'use strict';

const assert = require('node:assert/strict');
const { createLedger } = require('./factory-control-ledger.js');
const { createCommandAuthorizer } = require('./factory-control-authorization.js');
const { ACTIONS, createCommandExecutor } = require('./factory-control-executor.js');

// Existing command cases exercise the same explicit fake audit contract.
function fakeAuditStore() {
  return { append: async () => true };
}

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
  const executor = createCommandExecutor({ auditStore: fakeAuditStore(),
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
  const deniedExecutor = createCommandExecutor({ auditStore: fakeAuditStore(),
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
  const broadcastExecutor = createCommandExecutor({ auditStore: fakeAuditStore(),
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
  const failureExecutor = createCommandExecutor({ auditStore: fakeAuditStore(),
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
  const invalidOutcome = await createCommandExecutor({ auditStore: fakeAuditStore(),
    ledger: createLedger(memoryStore()),
    authorizer,
    effects: invalidOutcomeEffects
  }).execute(command('invalid-outcome', 'pause', 7), context);
  assert.equal(invalidOutcome.code, 'failed');
  assert.equal(JSON.stringify(invalidOutcome).includes('private diagnostic'), false);

  const mutatingCalls = [];
  const mutatingPayload = await createCommandExecutor({ auditStore: fakeAuditStore(),
    ledger: createLedger(memoryStore()),
    authorizer: {
      authorize: async input => {
        input.payload.text = 'mutated by untrusted authorizer';
        return {
          version: 1,
          kind: 'command',
          id: input.id,
          action: input.action,
          target: input.target,
          payload: input.payload
        };
      }
    },
    effects: effects(mutatingCalls)
  }).execute(
    command('mutating-authorizer', 'send_message', 7, { text: privateText }),
    context
  );
  assert.equal(mutatingPayload.code, 'unauthorized');
  assert.equal(mutatingCalls.length, 0);

  const tamperedCalls = [];
  const tampered = await createCommandExecutor({ auditStore: fakeAuditStore(),
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

  assert.throws(() => createCommandExecutor({ auditStore: fakeAuditStore(),}), /required/);
  const incomplete = effects([]);
  delete incomplete.open_chat;
  assert.throws(() => createCommandExecutor({ auditStore: fakeAuditStore(),
    ledger: createLedger(memoryStore()),
    authorizer,
    effects: incomplete
  }), /six command effect handlers/);


  // AC-03: the journal is distinct from idempotency receipts, persists when
  // adapters are recreated, and never contains chat text or identifiers.
  {
    const shared = { events: [] };
    const makeAudit = () => ({
      append: async event => {
        shared.events.push(structuredClone(event));
        return true;
      }
    });
    const calls = [];
    const receipts = memoryStore();
    const input = command('audited-once', 'send_message', 7, { text: privateText });
    const audited = createCommandExecutor({
      ledger: createLedger(receipts), authorizer,
      effects: effects(calls), auditStore: makeAudit()
    });
    assert.equal((await audited.execute(input, context)).code, 'ok');
    assert.equal(calls.length, 1);
    assert.equal((await createCommandExecutor({
      ledger: createLedger(receipts), authorizer,
      effects: effects(calls), auditStore: makeAudit()
    }).execute(input, context)).code, 'already_handled');
    assert.equal(calls.length, 1);
    assert.deepEqual(shared.events, [
      { event: 'command_execution', phase: 'decision', outcome: 'authorized' },
      { event: 'command_execution', phase: 'result', outcome: 'ok' }
    ]);
    assert.doesNotMatch(JSON.stringify(shared.events) + receipts.snapshot(),
      /private chat text|profile-one|private-token|audited-once|send_message|target/);

    // Denied commands produce a decision and result without any effect.
    const deniedEvents = [];
    const deniedEffects = [];
    const denied = await createCommandExecutor({
      ledger: createLedger(memoryStore()),
      authorizer: { authorize: async () => { throw Error('private-grant'); } },
      effects: effects(deniedEffects),
      auditStore: { append: async e => { deniedEvents.push(structuredClone(e)); return true; } }
    }).execute(command('audited-denied', 'send_message', 7), context);
    assert.equal(denied.code, 'unauthorized');
    assert.equal(deniedEffects.length, 0);
    assert.deepEqual(deniedEvents.map(e => e.outcome), ['unauthorized', 'unauthorized']);
    assert.doesNotMatch(JSON.stringify(deniedEvents), /private-grant|audited-denied/);
  }

  // AC-03: if writing the decision fails, the effect is never invoked.
  {
    for (const reply of [false, undefined, null]) {
      const effectsCalled = [];
      const badAudit = createCommandExecutor({
        ledger: createLedger(memoryStore()), authorizer,
        effects: effects(effectsCalled),
        auditStore: { append: async () => reply }
      });
      const outcome = await badAudit.execute(command('audit-not-written', 'send_message', 7), context);
      assert.equal(outcome.code, 'failed');
      assert.equal(effectsCalled.length, 0);
    }
    const errors = [];
    const withError = await createCommandExecutor({
      ledger: createLedger(memoryStore()), authorizer,
      effects: effects(errors),
      auditStore: { append: async () => { throw Error('private-adapter-secret'); } }
    }).execute(command('audit-error', 'send_message', 7), context);
    assert.equal(withError.code, 'failed');
    assert.equal(errors.length, 0);
    assert.doesNotMatch(JSON.stringify(withError), /private-adapter-secret/);
  }

  // AC-03: audit failure AFTER a completed fake effect cannot finalize the
  // receipt; a new executor/ledger must not run the same ID again.
  {
    const store = memoryStore();
    const effectCalls = [];
    const messages = [];
    const auditStore = {
      append: async event => {
        messages.push(structuredClone(event));
        return messages.length === 1;
      }
    };
    const input = command('uncertain-post-effect', 'send_message', 7, { text: privateText });
    const first = await createCommandExecutor({
      ledger: createLedger(store), authorizer,
      effects: effects(effectCalls), auditStore
    }).execute(input, context);
    assert.deepEqual(first, {
      version: 1, kind: 'ack', id: 'uncertain-post-effect', ok: false, code: 'not_ready'
    });
    assert.equal(effectCalls.length, 1);
    assert.deepEqual(JSON.parse(store.snapshot()), [
      { id: 'uncertain-post-effect', state: 'pending', code: null }
    ]);
    const replay = await createCommandExecutor({
      ledger: createLedger(store), authorizer,
      effects: effects(effectCalls), auditStore: fakeAuditStore()
    }).execute(input, context);
    assert.equal(replay.code, 'not_ready');
    assert.equal(effectCalls.length, 1);
    assert.doesNotMatch(JSON.stringify(messages) + store.snapshot(), /private chat text|profile-one/);
  }
  console.log('Factory Control audit AC-03: sanitized durable decisions, fail-closed pending and replay rejection pass');

  now = 10001;
  const expiredCalls = [];
  const expired = await createCommandExecutor({ auditStore: fakeAuditStore(),
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
