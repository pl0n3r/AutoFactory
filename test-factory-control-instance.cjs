const assert = require('node:assert/strict');
const { createInstanceStore, MAX_GRANT_TTL_MS } = require('./factory-control-instance.js');

const CHROME_ID = '123e4567-e89b-42d3-a456-426614174000';
const SAFARI_ID = '223e4567-e89b-42d3-a456-426614174001';

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) {
      const value = values.get(key);
      return value === undefined ? undefined : structuredClone(value);
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    },
    putRaw(key, value) {
      values.set(key, value);
    },
    snapshot() {
      return JSON.stringify([...values.entries()]);
    }
  };
}

function buildStore(storage, browser, id, clock) {
  return createInstanceStore({
    storage,
    uuid: () => id,
    now: () => clock.value,
    browser,
    extensionVersion: '1.6.15',
    protocolVersion: 2
  });
}

(async () => {
  const storage = memoryStorage();
  const clock = { value: 1_800_000_000_000 };
  const chrome = buildStore(storage, 'chrome', CHROME_ID, clock);
  const safari = buildStore(storage, 'safari', SAFARI_ID, clock);

  const created = await chrome.create('dev-main', 'macbook-pro');
  assert.equal(created.instanceId, CHROME_ID);
  assert.equal(created.browser, 'chrome');
  assert.equal(created.grant, null);
  assert.equal((await chrome.create('dev-main', 'macbook-pro')).instanceId, CHROME_ID);
  await assert.rejects(
    chrome.create('other-profile', 'macbook-pro'),
    /already exists/
  );

  const safariCreated = await safari.create('dev-main', 'macbook-pro');
  assert.equal(safariCreated.instanceId, SAFARI_ID);
  assert.notEqual(safariCreated.instanceId, created.instanceId);
  assert.equal((await chrome.load()).instanceId, CHROME_ID);

  assert.deepEqual(await chrome.safeSnapshot(), {
    instanceId: CHROME_ID,
    browser: 'chrome',
    profileAlias: 'dev-main',
    deviceAlias: 'macbook-pro',
    extensionVersion: '1.6.15',
    protocolVersion: 2
  });
  assert.doesNotMatch(
    JSON.stringify(await chrome.safeSnapshot()),
    /grant|token|secret|cookie|url|chat|account|prompt/i
  );

  for (const badAlias of ['', ' user ', 'user@example.com', 'line\nbreak']) {
    const isolated = buildStore(memoryStorage(), 'chrome', CHROME_ID, clock);
    await assert.rejects(isolated.create(badAlias, 'macbook-pro'), /alias/);
  }
  assert.throws(
    () => createInstanceStore({
      storage,
      uuid: () => CHROME_ID,
      now: () => clock.value,
      browser: 'edge',
      extensionVersion: '1.6.15',
      protocolVersion: 2
    }),
    /dependencies/
  );
  await assert.rejects(
    buildStore(memoryStorage(), 'chrome', '123e4567-e89b-12d3-a456-426614174000', clock)
      .create('dev-main', 'macbook-pro'),
    /v4/
  );

  const activeGrant = {
    instanceId: CHROME_ID,
    expiresAt: clock.value + 60_000,
    revoked: false,
    actions: ['pause', 'resume'],
    tabIds: [7, 9]
  };
  assert.deepEqual(await chrome.grant(activeGrant), activeGrant);
  assert.deepEqual((await chrome.load()).grant, activeGrant);

  clock.value += 60_001;
  assert.equal((await chrome.load()).grant, null);

  await assert.rejects(
    chrome.grant({ ...activeGrant, expiresAt: clock.value }),
    /grant/
  );
  await assert.rejects(
    chrome.grant({
      ...activeGrant,
      instanceId: SAFARI_ID,
      expiresAt: clock.value + 60_000
    }),
    /another instance/
  );
  await assert.rejects(
    chrome.grant({
      ...activeGrant,
      expiresAt: clock.value + MAX_GRANT_TTL_MS + 1
    }),
    /grant/
  );

  const renewed = {
    ...activeGrant,
    expiresAt: clock.value + 60_000
  };
  await chrome.grant(renewed);
  assert.equal((await chrome.load()).grant.instanceId, CHROME_ID);
  assert.equal(await chrome.revoke(), true);
  assert.equal((await chrome.load()).grant, null);

  const corruptIdentityStorage = memoryStorage();
  corruptIdentityStorage.putRaw(
    'factoryControlInstanceV2:chrome:identity',
    {
      version: 1,
      instanceId: CHROME_ID,
      browser: 'chrome',
      profileAlias: 'dev-main',
      deviceAlias: 'macbook-pro',
      createdAt: clock.value,
      secret: 'must-not-be-accepted'
    }
  );
  await assert.rejects(
    buildStore(corruptIdentityStorage, 'chrome', CHROME_ID, clock).load(),
    /Invalid persisted instance identity/
  );

  const corruptGrantStorage = memoryStorage();
  const corruptGrantStore = buildStore(corruptGrantStorage, 'chrome', CHROME_ID, clock);
  await corruptGrantStore.create('dev-main', 'macbook-pro');
  corruptGrantStorage.putRaw(
    'factoryControlInstanceV2:chrome:grant',
    { ...renewed, token: 'hidden' }
  );
  await assert.rejects(corruptGrantStore.load(), /Invalid persisted instance grant/);

  const unavailable = createInstanceStore({
    storage: {
      async get() { throw Error('private backend detail'); },
      async set() {},
      async remove() {}
    },
    uuid: () => CHROME_ID,
    now: () => clock.value,
    browser: 'chrome',
    extensionVersion: '1.6.15',
    protocolVersion: 2
  });
  await assert.rejects(
    unavailable.load(),
    error => error.message === 'Instance storage unavailable'
  );

  assert.doesNotMatch(storage.snapshot(), /email|cookie|token|secret|chat|prompt|url/i);
  console.log('Factory Control instance store: stable, browser-scoped, revocable and minimized');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
