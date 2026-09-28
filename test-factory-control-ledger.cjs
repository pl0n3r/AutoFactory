const assert = require('node:assert/strict');
const { createLedger } = require('./factory-control-ledger.js');
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
  console.log('Chrome profile credential store: scoped, expiring, revocable and fail-closed');
  console.log('Chrome receipt store: durable, duplicate-safe, fail-closed and data-minimized');
  console.log('Factory Control ledger: concurrent duplicates, restart, failure isolation, pending, capacity and corruption pass');
})().catch(error => { console.error(error); process.exitCode = 1; });
require('./test-factory-control-authorization.cjs');
