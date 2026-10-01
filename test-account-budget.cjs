'use strict';
const assert = require('node:assert/strict');
const budget = require('./account-budget.js');

function policy(limit = 4, windowMs = 60000, source = 'default') {
  return budget.normalizePolicy({ limit, windowMs }, source);
}
function consume(state, { at, limit = 4, windowMs = 60000, reasoningLevel = 'high' }) {
  return budget.consume(state, {
    accountAlias: 'primary', now: at, policy: policy(limit, windowMs), reasoningLevel
  });
}
function factoryPolicy(now, overrides = {}) {
  return {
    version: budget.FACTORY_POLICY_VERSION,
    accountAlias: 'primary',
    limit: 55,
    windowMs: 3600000,
    observedAt: now - 1000,
    expiresAt: now + 60000,
    ...overrides
  };
}

{
  const now = 1000000;
  const localSettings = { accountBudgetLimit: 40, accountBudgetWindowMinutes: 60 };
  const fallback = budget.effectivePolicy(localSettings, null, 'primary', now);
  assert.deepEqual(fallback, { limit: 40, windowMs: 3600000, source: 'default' });

  const learned = budget.effectivePolicy(
    localSettings, factoryPolicy(now), 'primary', now
  );
  assert.deepEqual(learned, { limit: 55, windowMs: 3600000, source: 'factory' });

  const stale = budget.effectivePolicy(
    localSettings,
    factoryPolicy(now, { observedAt: now - 61000, expiresAt: now }),
    'primary',
    now
  );
  assert.deepEqual(stale, fallback,
    'expired Factory evidence must fall back exactly to conservative local policy');

  const future = budget.effectivePolicy(
    localSettings,
    factoryPolicy(now, { observedAt: now + 1, expiresAt: now + 60001 }),
    'primary',
    now
  );
  assert.deepEqual(future, fallback,
    'future Factory evidence is unknown and must not override the fallback');

  assert.equal(budget.localPolicy({ accountBudgetLimit: 9999 }).limit, budget.MAX_EVENTS);
  assert.throws(() => budget.normalizePolicy({ limit: budget.MAX_EVENTS + 1, windowMs: 60000 }));
  assert.throws(() => budget.effectivePolicy(
    {}, factoryPolicy(now, { accountAlias: 'person@example.com' }), 'primary', now
  ));
  assert.throws(() => budget.effectivePolicy(
    {}, { ...factoryPolicy(now), freeText: 'forbidden' }, 'primary', now
  ));
  assert.throws(() => budget.effectivePolicy(
    {}, factoryPolicy(now, {
      observedAt: now - budget.MAX_FACTORY_POLICY_TTL_MS - 1,
      expiresAt: now + 1
    }), 'primary', now
  ));
}

{
  let state = {};
  const first = consume(state, { at: 100000 });
  assert.equal(first.allowed, true);
  state = first.state;
  const concurrent = consume(state, { at: 100000 });
  assert.equal(concurrent.allowed, false, 'a second tab must not race through the shared pace gate');
  assert.equal(concurrent.snapshot.sent, 1);
  assert.equal(concurrent.snapshot.nextAllowedAt, 115000);
}

{
  let state = {};
  let result = consume(state, { at: 120000, limit: 2, windowMs: 60000 });
  assert.equal(result.allowed, true);
  state = result.state;
  result = consume(state, { at: 150000, limit: 2, windowMs: 60000 });
  assert.equal(result.allowed, true);
  state = result.state;
  const capped = consume(state, { at: 179999, limit: 2, windowMs: 60000 });
  assert.equal(capped.allowed, false, 'confirmed sends must respect the rolling-window cap');
  assert.equal(capped.snapshot.remaining, 0);
  const reopened = consume(capped.state, { at: 180001, limit: 2, windowMs: 60000 });
  assert.equal(reopened.allowed, true, 'capacity reopens only after the oldest send exits the window');
}

{
  let state = {};
  const sent = consume(state, { at: 100000 });
  state = sent.state;
  const refreshed = budget.refresh(state, 'primary', policy(), 160001);
  assert.equal(refreshed.snapshot.sent, 0);
  assert.deepEqual(refreshed.state.accounts.primary.sends, [],
    'refresh must return the pruned state so storage can enforce rolling retention');
}

{
  let state = {};
  let limited = budget.recordLimit(state, {
    accountAlias: 'primary', now: 200000, policy: policy(), reasoningLevel: 'high'
  });
  state = limited.state;
  assert.equal(limited.snapshot.limitEvents, 1);
  const blocked = consume(state, { at: 200001 });
  assert.equal(blocked.allowed, false, 'a detected provider limit pauses every tab of the same account');
  assert.equal(blocked.snapshot.nextAllowedAt, 200000 + budget.DEFAULT_UNKNOWN_LIMIT_PAUSE_MS);
}

{
  let state = {};
  const result = consume(state, { at: 300000, reasoningLevel: 'high' });
  const snapshot = budget.snapshot(result.state, 'primary', policy(), 300002);
  assert.equal(snapshot.sent, 1);
  assert.equal(snapshot.highReasoningSends, 1);
  assert.equal(Object.hasOwn(snapshot, 'accountAlias'), false);
  assert.equal(JSON.stringify(snapshot).includes('prompt'), false);
}

console.log('account-budget: ok');
