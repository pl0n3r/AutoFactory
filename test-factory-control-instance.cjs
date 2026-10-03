const assert = require('node:assert/strict');
const {
  createInstanceStore,
  PROTOCOL_VERSION,
  MAX_GRANT_MS
} = require('./factory-control-instance.js');

const NOW = 1_800_000_000_000;
const CHROME_ID = '123e4567-e89b-42d3-a456-426614174000';
const SAFARI_ID = '123e4567-e89b-42d3-b456-426614174001';

function memoryStorage() {
  const rows = new Map();
  return {
    async get(key) {
      return rows.has(key) ? structuredClone(rows.get(key)) : null;
    },
    async set(key, value) {
      rows.set(key, structuredClone(value));
    },
    async remove(key) {
      rows.delete(key);
    },
    raw(key, value) {
      if (arguments.length === 2) rows.set(key, value);
      return rows.get(key);
    },
    snapshot() {
      return JSON.stringify([...rows.entries()]);
    }
  };
}

(async () => {
  const storage = memoryStorage();
  let chromeUuidCalls = 0;
  const chrome = createInstanceStore({
    storage,
    uuid: () => {
      chromeUuidCalls += 1;
      return CHROME_ID;
    },
    now: () => NOW,
    browser: 'chrome',
    extensionVersion: '1.6.15'
  });

  const created = await chrome.create('work-profile', 'Felipe Mac');
  assert.equal(created.instanceId, CHROME_ID);
  assert.equal(created.browser, 'chrome');
  assert.equal(created.protocolVersion, PROTOCOL_VERSION);
  assert.equal(created.grant, null);
  assert.equal(chromeUuidCalls, 1);

  const same = await chrome.create('work-profile', 'Felipe Mac');
  assert.equal(same.instanceId, CHROME_ID);
  assert.equal(chromeUuidCalls, 1);
  await assert.rejects(
    chrome.create('other-profile', 'Felipe Mac'),
    /immutable/
  );
  await assert.rejects(
    chrome.create('name@example.com', 'Felipe Mac'),
    /profile alias/
  );

  const snapshot = await chrome.safeSnapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'browser', 'deviceAlias', 'extensionVersion',
    'instanceId', 'profileAlias', 'protocolVersion'
  ].sort());
  assert.deepEqual(snapshot, {
    instanceId: CHROME_ID,
    browser: 'chrome',
    profileAlias: 'work-profile',
    deviceAlias: 'Felipe Mac',
    extensionVersion: '1.6.15',
    protocolVersion: 2
  });

  let safariUuidCalls = 0;
  const safari = createInstanceStore({
    storage,
    uuid: () => {
      safariUuidCalls += 1;
      return SAFARI_ID;
    },
    now: () => NOW,
    browser: 'safari',
    extensionVersion: '1.6.15'
  });
  const safariCreated = await safari.create('work-profile', 'Felipe Mac');
  assert.equal(safariCreated.instanceId, SAFARI_ID);
  assert.equal(safariUuidCalls, 1);
  assert.equal((await chrome.load()).instanceId, CHROME_ID);
  assert.equal((await safari.load()).instanceId, SAFARI_ID);

  await assert.rejects(
    chrome.grant({ id: 'grant-001', actions: ['pause'], expiresAt: NOW }),
    /grant/
  );
  await assert.rejects(
    chrome.grant({
      id: 'grant-002',
      actions: ['pause'],
      expiresAt: NOW + MAX_GRANT_MS + 1
    }),
    /grant/
  );
  await assert.rejects(
    chrome.grant({
      id: 'grant-003',
      actions: ['pause', 'pause'],
      expiresAt: NOW + 60_000
    }),
    /grant/
  );

  assert.deepEqual(
    await chrome.grant({
      id: 'grant-004',
      actions: ['pause', 'resume'],
      expiresAt: NOW + 60_000
    }),
    {
      id: 'grant-004',
      actions: ['pause', 'resume'],
      expiresAt: NOW + 60_000,
      revoked: false
    }
  );
  assert.equal((await chrome.load()).grant.revoked, false);
  assert.equal(await chrome.revoke(), true);
  assert.equal((await chrome.load()).grant.revoked, true);
  assert.equal(await chrome.revoke(), false);

  assert.doesNotMatch(
    storage.snapshot(),
    /https?:|@example|chat text|cookie|token|private key/i
  );

  storage.raw('factoryControlInstanceV2:chrome', {
    version: 1,
    instanceId: CHROME_ID,
    browser: 'safari',
    profileAlias: 'work-profile',
    deviceAlias: 'Felipe Mac',
    extensionVersion: '1.6.15',
    protocolVersion: 2,
    grant: null
  });
  await assert.rejects(chrome.load(), /instance state/);

  storage.raw('factoryControlInstanceV2:chrome', {
    version: 1,
    instanceId: CHROME_ID,
    browser: 'chrome',
    profileAlias: 'work-profile',
    deviceAlias: 'Felipe Mac',
    extensionVersion: '1.6.15',
    protocolVersion: 2,
    grant: null,
    token: 'must-never-be-accepted'
  });
  await assert.rejects(chrome.load(), /instance state/);

  const brokenStorage = {
    async get() { throw Error('private filesystem path'); },
    async set() { throw Error('secret token'); },
    async remove() { throw Error('private runtime detail'); }
  };
  const broken = createInstanceStore({
    storage: brokenStorage,
    uuid: () => CHROME_ID,
    now: () => NOW,
    browser: 'chrome',
    extensionVersion: '1.6.15'
  });
  await assert.rejects(
    broken.load(),
    error => error.message === 'Instance storage unavailable'
  );

  console.log('Factory Control instance identity: stable, browser-scoped and data-minimized');
  console.log('Factory Control instance grant: expiring, revocable and fail-closed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
