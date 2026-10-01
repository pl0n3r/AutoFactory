'use strict';
const assert = require('node:assert/strict');
const budget = require('./account-budget.js');
const runtime = require('./account-budget-background.js');

function fakeStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(defaults) { return { ...structuredClone(defaults), ...structuredClone(values) }; },
    async set(next) { Object.assign(values, structuredClone(next)); }
  };
}

(async () => {
  let now = 100000;
  const storage = fakeStorage({
    accountBudgetAccountAlias: 'primary',
    accountBudgetLimit: 2,
    accountBudgetWindowMinutes: 1
  });
  const controller = runtime.createController({ storage, now: () => now });

  const first = await controller.consume({ reasoningLevel: 'high' });
  assert.equal(first.allowed, true);
  const raced = await Promise.all([
    controller.consume({ reasoningLevel: 'high' }),
    controller.consume({ reasoningLevel: 'high' })
  ]);
  assert.equal(raced.filter(item => item.allowed).length, 0,
    'serialized tabs must share the same pace gate');

  now = 130000;
  const second = await controller.consume({ reasoningLevel: 'unknown' });
  assert.equal(second.allowed, true);
  assert.equal(second.snapshot.sent, 2);

  storage.values[budget.FACTORY_POLICY_KEY] = {
    version: budget.FACTORY_POLICY_VERSION,
    accountAlias: 'primary',
    limit: 4,
    windowMs: 60000,
    observedAt: now,
    expiresAt: 160000
  };
  const updated = await controller.status();
  assert.equal(updated.snapshot.source, 'factory');
  assert.equal(updated.snapshot.budget, 4,
    'fresh Factory policy must replace fallback without restarting the controller');

  now = 145000;
  const third = await controller.consume({ reasoningLevel: 'high' });
  assert.equal(third.allowed, true, 'live Factory policy should immediately change pacing');

  now = 160001;
  const stale = await controller.status();
  assert.equal(stale.snapshot.source, 'default');
  assert.equal(stale.snapshot.budget, 2,
    'expired Factory policy must automatically return to the conservative fallback');

  now = 170000;
  const limited = await controller.recordLimit({ reasoningLevel: 'high', resetAt: 200000 });
  assert.equal(limited.snapshot.limitEvents, 1);
  now = 175000;
  const blocked = await controller.consume({ reasoningLevel: 'high' });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.snapshot.nextAllowedAt, 200000);

  now = 300001;
  const expired = await controller.status();
  assert.equal(expired.snapshot.sent, 0);
  assert.equal(expired.snapshot.limitEvents, 0);
  assert.deepEqual(storage.values[budget.STATE_KEY].accounts.primary.sends, []);
  assert.deepEqual(storage.values[budget.STATE_KEY].accounts.primary.limits, []);
  assert.equal(storage.values[budget.STATE_KEY].accounts.primary.blockedUntil, 0,
    'status must persist the pruned rolling state');

  assert.equal(JSON.stringify(storage.values).includes('chat'), false);
  assert.equal(JSON.stringify(storage.values).includes('prompt'), false);
  assert.equal(JSON.stringify(storage.values).includes('@'), false);

  console.log('account-budget-background: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
