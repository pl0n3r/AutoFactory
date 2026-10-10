const assert = require('node:assert/strict');
const { createLedger, createInstanceLedger } = require('./factory-control-ledger.js');
const { createInstanceCommandAuthorizer } = require('./factory-control-authorization.js');
const {
  createChromeReceiptStore,
  createChromeProfileCredentialStore,
  KEY,
  CREDENTIAL_KEY
} = require('./factory-control-chrome-storage.js');
const command = id => ({ id, action: 'send_message', target: 9, payload: { text: 'private chat text' } });
const memory = () => {
  let receipts = [];
  return {
    load: async () => structuredClone(receipts),
    save: async value => { receipts = structuredClone(value); },
    snapshot: () => JSON.stringify(receipts)
  };
};
(async () => {
  const store = memory();
  const ledger = createLedger(store);
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = ledger.execute(command('same-id'), async () => {
    calls += 1;
    await gate;
    return { ok: true, code: 'ok' };
  });
  const duplicate = ledger.execute(command('same-id'), async () => {
    calls += 1;
    return { ok: true, code: 'ok' };
  });
  release();
  assert.equal((await first).code, 'ok');
  assert.equal((await duplicate).code, 'already_handled');
  assert.equal(calls, 1);
  assert.equal((await createLedger(store).execute(command('same-id'), async () => {
    calls += 1;
    return { ok: true, code: 'ok' };
  })).code, 'already_handled');
  assert.equal(calls, 1);
  assert.doesNotMatch(store.snapshot(), /private chat text|payload|token|error/);

  const noSave = createLedger({ load: async () => [], save: async () => { throw Error('disk error'); } });
  await assert.rejects(noSave.execute(command('store-fails'), async () => {
    calls += 1;
    return { ok: true, code: 'ok' };
  }), /disk error/);
  assert.equal(calls, 1);

  const failedStore = memory();
  const failing = createLedger(failedStore);
  const failed = await failing.execute(command('fails'), async () => {
    throw Error('secret in arbitrary exception');
  });
  assert.deepEqual(failed, { version: 1, kind: 'ack', id: 'fails', ok: false, code: 'failed' });
  assert.doesNotMatch(failedStore.snapshot(), /secret|private chat text/);
  assert.equal((await createLedger(failedStore).execute(command('fails'), async () => {
    calls += 1;
    return { ok: true, code: 'ok' };
  })).code, 'already_handled');
  assert.equal(calls, 1);

  const pending = createLedger({ load: async () => [{ id: 'started', state: 'pending', code: null }], save: async () => {} });
  assert.equal((await pending.execute(command('started'), async () => {
    calls += 1;
    return { ok: true, code: 'ok' };
  })).code, 'not_ready');
  assert.equal(calls, 1);

  const full = memory();
  const tiny = createLedger({ ...full, maxEntries: 1 });
  await tiny.execute(command('first'), async () => ({ ok: true, code: 'ok' }));
  await assert.rejects(tiny.execute(command('second'), async () => {
    calls += 1;
    return { ok: true, code: 'ok' };
  }), /full/);
  assert.equal(calls, 1);

  const corrupted = createLedger({ load: async () => [{ id: 'started', state: 'done', code: 'ok', chat: 'private' }], save: async () => {} });
  await assert.rejects(corrupted.execute(command('other'), async () => {
    calls += 1;
  }), /receipt/);
  assert.equal(calls, 1);
  for (const malformed of [
    Array(1),
    [{ id: 'existing', state: 'done', code: 'ok' }, ,]
  ]) {
    let persistedWrites = 0;
    const malformedLedger = createLedger({
      load: async () => malformed,
      save: async () => { persistedWrites += 1; }
    });
    await assert.rejects(malformedLedger.execute(command('sparse'), async () => {
      calls += 1;
      return { ok: true, code: 'ok' };
    }), /Invalid persisted command ledger/);
    assert.equal(persistedWrites, 0);
    assert.equal(calls, 1);
  }
  await assert.rejects(ledger.execute({ id: 'invalid', action: 'delete_account', target: 9 }, async () => {}), /Unsupported/);

  let persisted = {};
  let failGet = false;
  let failSet = false;
  const runtime = { lastError: null };
  const local = {
    get(defaults, callback) {
      queueMicrotask(() => {
        runtime.lastError = failGet ? { message: 'private path or token' } : null;
        callback({ ...defaults, ...structuredClone(persisted) });
        runtime.lastError = null;
      });
    },
    set(value, callback) {
      queueMicrotask(() => {
        runtime.lastError = failSet ? { message: 'sensitive account details' } : null;
        if (!failSet) Object.assign(persisted, structuredClone(value));
        callback();
        runtime.lastError = null;
      });
    }
  };
  assert.throws(() => createChromeReceiptStore({}), /required/);
  const browserStore = createChromeReceiptStore({ local, runtime });
  let browserCalls = 0;
  const browserLedger = createLedger(browserStore);
  assert.equal((await browserLedger.execute(command('chrome-persist'), async () => {
    browserCalls += 1;
    return { ok: true, code: 'ok' };
  })).code, 'ok');
  assert.deepEqual(Object.keys(persisted), [KEY]);
  assert.deepEqual(persisted[KEY], [{ id: 'chrome-persist', state: 'done', code: 'ok' }]);
  assert.equal(JSON.stringify(persisted).includes('private chat text'), false);
  assert.equal((await createLedger(createChromeReceiptStore({ local, runtime }))
    .execute(command('chrome-persist'), async () => {
      browserCalls += 1;
      return { ok: true, code: 'ok' };
    })).code, 'already_handled');
  assert.equal(browserCalls, 1);
  failSet = true;
  await assert.rejects(browserLedger.execute(command('quota-fail'), async () => {
    browserCalls += 1;
    return { ok: true, code: 'ok' };
  }), /storage unavailable/);
  assert.equal(browserCalls, 1);
  assert.equal(JSON.stringify(persisted).includes('quota-fail'), false);
  failSet = false;
  failGet = true;
  await assert.rejects(browserLedger.execute(command('read-fail'), async () => {
    browserCalls += 1;
    return { ok: true, code: 'ok' };
  }), /storage unavailable/);
  assert.equal(browserCalls, 1);
  failGet = false;
  await assert.rejects(browserStore.save(Array(1)), /receipt collection/);
  await assert.rejects(browserStore.save([undefined]), /receipt/);
  await assert.rejects(browserStore.save([{ id: 'bad', state: 'done', code: 'ok', text: 'secret' }]), /receipt/);
  assert.equal(JSON.stringify(persisted).includes('secret'), false);
  persisted[KEY] = [{ id: 'bad-id', state: 'done', code: 'ok', text: 'private' }];
  await assert.rejects(browserLedger.execute(command('corrupt-read'), async () => {
    browserCalls += 1;
    return { ok: true, code: 'ok' };
  }), /receipt/);
  assert.equal(browserCalls, 1);
  persisted[KEY] = [{ id: 'pending-id', state: 'pending', code: null }];
  assert.equal((await createLedger(browserStore).execute(command('pending-id'), async () => {
    browserCalls += 1;
    return { ok: true, code: 'ok' };
  })).code, 'not_ready');
  assert.equal(browserCalls, 1);

  const NOW = 1_800_000_000_000;
  const credentials = createChromeProfileCredentialStore({
    local, runtime, now: () => NOW
  });
  await credentials.save({
    profileAlias: 'profile-a',
    id: 'credential-001',
    expiresAt: NOW + 3_600_000
  });
  assert.deepEqual(persisted[CREDENTIAL_KEY], [{
    profileAlias: 'profile-a',
    id: 'credential-001',
    expiresAt: NOW + 3_600_000
  }]);
  assert.deepEqual(await credentials.load('profile-a'), {
    id: 'credential-001',
    expiresAt: NOW + 3_600_000
  });
  assert.equal(await credentials.load('profile-b'), null);
  assert.equal(await credentials.remove({
    profileAlias: 'profile-b', id: 'credential-001'
  }), false);
  assert.equal(await credentials.remove({
    profileAlias: 'profile-a', id: 'other-credential'
  }), false);
  assert.equal(await credentials.remove({
    profileAlias: 'profile-a', id: 'credential-001'
  }), true);
  assert.deepEqual(persisted[CREDENTIAL_KEY], []);

  await assert.rejects(credentials.save({
    profileAlias: 'name@example.com',
    id: 'credential-002',
    expiresAt: NOW + 1000
  }), /profile alias/);
  await assert.rejects(credentials.save({
    profileAlias: 'profile-a',
    id: 'credential-002',
    expiresAt: NOW
  }), /opaque credential/);
  await assert.rejects(credentials.save({
    profileAlias: 'profile-a',
    id: 'credential-002',
    expiresAt: NOW + 86_400_001
  }), /opaque credential/);

  await credentials.save({
    profileAlias: 'profile-a',
    id: 'credential-003',
    expiresAt: NOW + 1000
  });
  const expiredStore = createChromeProfileCredentialStore({
    local, runtime, now: () => NOW + 1000
  });
  assert.equal(await expiredStore.load('profile-a'), null);
  assert.equal(await expiredStore.remove({
    profileAlias: 'profile-a', id: 'credential-003'
  }), true);

  persisted[CREDENTIAL_KEY] = [{
    profileAlias: 'profile-a',
    id: 'credential-004',
    expiresAt: NOW + 1000,
    token: 'must-never-be-accepted'
  }];
  await assert.rejects(credentials.load('profile-a'), /credential/);
  assert.equal(JSON.stringify(persisted).includes('must-never-be-accepted'), true);
  persisted[CREDENTIAL_KEY] = [];

  failSet = true;
  await assert.rejects(credentials.save({
    profileAlias: 'profile-a',
    id: 'credential-005',
    expiresAt: NOW + 1000
  }), error =>
    error.message === 'Profile credential storage unavailable' &&
    !error.message.includes('sensitive account details')
  );
  failSet = false;
  failGet = true;
  await assert.rejects(credentials.load('profile-a'), error =>
    error.message === 'Profile credential storage unavailable' &&
    !error.message.includes('private path or token')
  );
  failGet = false;

  assert.doesNotMatch(
    JSON.stringify(persisted),
    /private chat text|password|session_cookie|pairing code/
  );

  const INSTANCE_ID = '123e4567-e89b-42d3-a456-426614174000';
  const OTHER_INSTANCE_ID = '123e4567-e89b-42d3-b456-426614174001';
  const V2_NOW = 1_800_000_100_000;
  const instanceCommand = (overrides = {}) => ({
    version: 2,
    kind: 'command',
    id: 'instance-command',
    instanceId: INSTANCE_ID,
    action: 'pause',
    target: 'instance',
    issuedAt: V2_NOW - 1000,
    expiresAt: V2_NOW + 60_000,
    ...overrides
  });

  const grant = () => ({
    instanceId: INSTANCE_ID,
    expiresAt: V2_NOW + 3_600_000,
    revoked: false,
    actions: ['pause', 'resume'],
    tabIds: [7, 9]
  });
  const authorizer = createInstanceCommandAuthorizer({
    loadVerifiedGrant: async () => grant(),
    now: () => V2_NOW
  });
  assert.deepEqual(
    await authorizer.authorize(instanceCommand(), {
      instanceId: INSTANCE_ID,
      enabledTabIds: [7, 9]
    }),
    instanceCommand()
  );
  assert.equal(
    (await authorizer.authorize(instanceCommand({
      id: 'tab-resume',
      action: 'resume',
      target: 7
    }), {
      instanceId: INSTANCE_ID,
      enabledTabIds: [7, 9]
    })).target,
    7
  );

  const deniedCases = [
    {
      command: instanceCommand({ instanceId: OTHER_INSTANCE_ID }),
      context: { instanceId: INSTANCE_ID, enabledTabIds: [7, 9] },
      load: async () => grant(),
      now: () => V2_NOW
    },
    {
      command: instanceCommand({ id: 'expired', expiresAt: V2_NOW }),
      context: { instanceId: INSTANCE_ID, enabledTabIds: [7, 9] },
      load: async () => grant(),
      now: () => V2_NOW
    },
    {
      command: instanceCommand({ id: 'future', issuedAt: V2_NOW + 1, expiresAt: V2_NOW + 1000 }),
      context: { instanceId: INSTANCE_ID, enabledTabIds: [7, 9] },
      load: async () => grant(),
      now: () => V2_NOW
    },
    {
      command: instanceCommand({ id: 'wrong-tab', target: 10 }),
      context: { instanceId: INSTANCE_ID, enabledTabIds: [7, 10] },
      load: async () => grant(),
      now: () => V2_NOW
    },
    {
      command: instanceCommand({ id: 'revoked' }),
      context: { instanceId: INSTANCE_ID, enabledTabIds: [7, 9] },
      load: async () => ({ ...grant(), revoked: true }),
      now: () => V2_NOW
    },
    {
      command: instanceCommand({ id: 'grant-expired' }),
      context: { instanceId: INSTANCE_ID, enabledTabIds: [7, 9] },
      load: async () => ({ ...grant(), expiresAt: V2_NOW }),
      now: () => V2_NOW
    },
    {
      command: instanceCommand({ id: 'grant-cross-instance' }),
      context: { instanceId: INSTANCE_ID, enabledTabIds: [7, 9] },
      load: async () => ({ ...grant(), instanceId: OTHER_INSTANCE_ID }),
      now: () => V2_NOW
    }
  ];
  for (const item of deniedCases) {
    const deniedAuthorizer = createInstanceCommandAuthorizer({
      loadVerifiedGrant: item.load,
      now: item.now
    });
    await assert.rejects(
      deniedAuthorizer.authorize(item.command, item.context),
      error => error.message === 'Command not authorized'
    );
  }

  const v2Store = memory();
  const v2Ledger = createInstanceLedger({
    instanceId: INSTANCE_ID,
    load: v2Store.load,
    save: v2Store.save
  });
  let v2Calls = 0;
  const firstV2Ack = await v2Ledger.execute(instanceCommand(), async commandV2 => {
    v2Calls += 1;
    assert.equal(commandV2.instanceId, INSTANCE_ID);
    return { ok: true, code: 'ok', enabled: false, appliedTabs: [7, 9] };
  });
  assert.deepEqual(firstV2Ack, {
    version: 2,
    kind: 'ack',
    id: 'instance-command',
    instanceId: INSTANCE_ID,
    ok: true,
    code: 'ok',
    enabled: false,
    appliedTabs: [7, 9]
  });
  const duplicateV2Ack = await createInstanceLedger({
    instanceId: INSTANCE_ID,
    load: v2Store.load,
    save: v2Store.save
  }).execute(instanceCommand(), async () => {
    v2Calls += 1;
    return { ok: true, code: 'ok', enabled: true, appliedTabs: [] };
  });
  assert.deepEqual(duplicateV2Ack, firstV2Ack);
  assert.equal(v2Calls, 1);
  assert.doesNotMatch(v2Store.snapshot(), /chat|url|email|token|cookie|secret|payload/i);

  await assert.rejects(
    v2Ledger.execute(instanceCommand({
      action: 'resume',
      target: 7
    }), async () => {
      v2Calls += 1;
      return { ok: true, code: 'ok', enabled: true, appliedTabs: [7] };
    }),
    /already bound/
  );
  assert.equal(v2Calls, 1);

  await assert.rejects(
    v2Ledger.execute(instanceCommand({
      id: 'other-instance',
      instanceId: OTHER_INSTANCE_ID
    }), async () => {
      v2Calls += 1;
      return { ok: true, code: 'ok', enabled: false, appliedTabs: [] };
    }),
    /does not match ledger/
  );
  assert.equal(v2Calls, 1);

  const failedV2Store = memory();
  const failedV2 = await createInstanceLedger({
    instanceId: INSTANCE_ID,
    load: failedV2Store.load,
    save: failedV2Store.save
  }).execute(instanceCommand({ id: 'handler-fails' }), async () => {
    throw Error('private runtime details');
  });
  assert.equal(failedV2.code, 'failed');
  assert.equal(failedV2.enabled, false);
  assert.deepEqual(failedV2.appliedTabs, []);
  assert.doesNotMatch(failedV2Store.snapshot(), /private runtime details|secret|token/i);

  let preEffectCalls = 0;
  const v2NoSave = createInstanceLedger({
    instanceId: INSTANCE_ID,
    load: async () => [],
    save: async () => { throw Error('storage unavailable'); }
  });
  await assert.rejects(
    v2NoSave.execute(instanceCommand({ id: 'persist-first' }), async () => {
      preEffectCalls += 1;
      return { ok: true, code: 'ok', enabled: false, appliedTabs: [] };
    }),
    /storage unavailable/
  );
  assert.equal(preEffectCalls, 0);

  const pendingV2 = {
    id: 'pending-v2',
    instanceId: INSTANCE_ID,
    commandKey: 'pause:instance:' + (V2_NOW - 1000) + ':' + (V2_NOW + 60_000),
    state: 'pending',
    code: 'not_ready',
    enabled: false,
    appliedTabs: []
  };
  const pendingAck = await createInstanceLedger({
    instanceId: INSTANCE_ID,
    load: async () => [pendingV2],
    save: async () => {}
  }).execute(instanceCommand({ id: 'pending-v2' }), async () => {
    preEffectCalls += 1;
    return { ok: true, code: 'ok', enabled: false, appliedTabs: [] };
  });
  assert.equal(pendingAck.code, 'not_ready');
  assert.equal(preEffectCalls, 0);

  const corruptedV2 = createInstanceLedger({
    instanceId: INSTANCE_ID,
    load: async () => [{ ...pendingV2, token: 'hidden' }],
    save: async () => {}
  });
  await assert.rejects(
    corruptedV2.execute(instanceCommand({ id: 'new-v2' }), async () => {
      preEffectCalls += 1;
    }),
    /receipt/
  );
  assert.equal(preEffectCalls, 0);

  console.log('Chrome profile credential store: scoped, expiring, revocable and fail-closed');
  console.log('Chrome receipt store: durable, duplicate-safe, fail-closed and data-minimized');
  // AC-03: a ledger-issued ambiguous-outcome capability must keep pending
  // even after the original process/ledger instance disappears.
  {
    const store = memory();
    const ledger = createLedger(store);
    let effects = 0;
    const input = command('audit-uncertain-ledger');
    const outcome = await ledger.execute(input, async () => {
      effects += 1;
      return ledger.deferOutcome();
    });
    assert.equal(outcome.code, 'not_ready');
    assert.equal(outcome.ok, false);
    assert.deepEqual(JSON.parse(store.snapshot()), [
      { id: 'audit-uncertain-ledger', state: 'pending', code: null }
    ]);
    const replay = await createLedger(store).execute(input, async () => {
      effects += 1;
      return { ok: true, code: 'ok' };
    });
    assert.equal(replay.code, 'not_ready');
    assert.equal(effects, 1);
  }
  console.log('Factory Control ledger AC-03: ambiguous result stays pending across restart');

  console.log('Factory Control ledger: concurrent duplicates, restart, failure isolation, pending, capacity and corruption pass');
  console.log('Factory Control v2 authorization and ledger: instance-scoped, expiring and idempotent');
})().catch(error => { console.error(error); process.exitCode = 1; });
require('./test-factory-control-authorization.cjs');
