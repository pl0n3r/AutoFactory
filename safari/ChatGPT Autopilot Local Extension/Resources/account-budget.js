'use strict';

function budgetClock(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid budget clock');
  }
  return value;
}

function budgetPositiveInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

function budgetPruneAccount(row, now, policy) {
  const cutoff = now - policy.windowMs;
  return {
    sends: row.sends.filter(item => item.at > cutoff),
    limits: row.limits.filter(item => item.at > cutoff),
    blockedUntil: row.blockedUntil > now ? row.blockedUntil : 0
  };
}

function budgetCapacityAt(row, policy) {
  if (policy.limit === 0 || row.sends.length < policy.limit) return 0;
  return Math.min(...row.sends.map(item => item.at + policy.windowMs));
}

function budgetPaceAt(row, policy) {
  if (policy.limit === 0 || !row.sends.length) return 0;
  const latest = Math.max(...row.sends.map(item => item.at));
  const interval = policy.minIntervalMs || Math.ceil(policy.windowMs / policy.limit);
  return latest + interval;
}

function budgetSummary(row, policy, now) {
  const sent = row.sends.length;
  const policyPauseAt = policy.source === 'factory' && policy.limit === 0
    ? policy.expiresAt : 0;
  const nextAllowedAt = Math.max(
    row.blockedUntil,
    policyPauseAt || 0,
    budgetCapacityAt(row, policy),
    budgetPaceAt(row, policy)
  );
  return Object.freeze({
    windowMs: policy.windowMs,
    budget: policy.limit,
    sent,
    remaining: Math.max(0, policy.limit - sent),
    limitEvents: row.limits.length,
    highReasoningSends: row.sends.filter(item => item.reasoningLevel === 'high').length,
    nextAllowedAt: nextAllowedAt > now ? nextAllowedAt : null,
    source: policy.source
  });
}

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotAccountBudget = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STATE_KEY = 'accountBudgetStateV1';
  const SNAPSHOT_KEY = 'accountBudgetSnapshotV1';
  const FACTORY_POLICY_KEY = 'factoryAccountBudgetV1';
  const FACTORY_POLICY_VERSION = 1;
  const DEFAULT_ACCOUNT_ALIAS = 'primary';
  const DEFAULT_LIMIT = 40;
  const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
  const DEFAULT_UNKNOWN_LIMIT_PAUSE_MS = 15 * 60 * 1000;
  const MAX_FACTORY_POLICY_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_EVENTS = 512;
  const ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const REASONING = /^(?:high|medium|low|unknown)$/;
  const ACCOUNT_FIELDS = new Set(['sends', 'limits', 'blockedUntil']);
  const FACTORY_POLICY_FIELDS = new Set([
    'version', 'accountAlias', 'status', 'budget', 'observedAt', 'expiresAt',
    'source', 'capacityFingerprint', 'fingerprint'
  ]);
  const FACTORY_BUDGET_FIELDS = new Set(['limit', 'windowMs', 'minIntervalMs']);
  const FACTORY_STATUSES = new Set(['UNKNOWN', 'FRESH', 'STALE']);
  const FACTORY_SOURCES = new Set([
    'conservative-default', 'observed-limit', 'observed-success'
  ]);
  const FINGERPRINT = /^[0-9a-f]{64}$/;

  function accountAlias(value) {
    if (typeof value !== 'string' || !ALIAS.test(value) || value.includes('@')) {
      throw new TypeError('Invalid budget account alias');
    }
    return value;
  }

  function reasoningLevel(value) {
    if (value === undefined || value === null || value === '' || value === 'keep') {
      return 'unknown';
    }
    if (typeof value !== 'string' || !REASONING.test(value)) {
      throw new TypeError('Invalid reasoning level');
    }
    return value;
  }

  function normalizePolicy(input = {}, source = 'default') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Invalid budget policy');
    }
    if (!['default', 'factory'].includes(source)) {
      throw new TypeError('Invalid budget policy source');
    }
    if (source === 'factory') {
      const limit = budgetPositiveInteger(input.limit, 0, MAX_EVENTS, 'budget limit');
      const windowMs = budgetPositiveInteger(
        input.windowMs, 1000, 24 * 60 * 60 * 1000, 'budget window'
      );
      const minIntervalMs = budgetPositiveInteger(
        input.minIntervalMs, 1, 24 * 60 * 60 * 1000, 'budget interval'
      );
      const expiresAt = budgetClock(input.expiresAt);
      if (limit > 0 && minIntervalMs < Math.ceil(windowMs / limit)) {
        throw new TypeError('Invalid Factory budget pace');
      }
      return Object.freeze({
        limit, windowMs, minIntervalMs, expiresAt, source
      });
    }
    const limit = budgetPositiveInteger(
      input.limit === undefined ? DEFAULT_LIMIT : input.limit,
      1, MAX_EVENTS, 'budget limit'
    );
    const windowMs = budgetPositiveInteger(
      input.windowMs === undefined ? DEFAULT_WINDOW_MS : input.windowMs,
      60 * 1000, 24 * 60 * 60 * 1000, 'budget window'
    );
    return Object.freeze({ limit, windowMs, source });
  }

  function localPolicy(settings = {}) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new TypeError('Invalid budget settings');
    }
    const rawLimit = Number(settings.accountBudgetLimit);
    const rawWindowMinutes = Number(settings.accountBudgetWindowMinutes);
    const limit = Number.isSafeInteger(rawLimit) && rawLimit >= 1
      ? Math.min(MAX_EVENTS, rawLimit) : DEFAULT_LIMIT;
    const windowMinutes = Number.isSafeInteger(rawWindowMinutes) && rawWindowMinutes >= 1
      ? Math.min(24 * 60, rawWindowMinutes) : DEFAULT_WINDOW_MS / 60000;
    return normalizePolicy({ limit, windowMs: windowMinutes * 60000 });
  }

  function factoryPolicy(value, alias, now) {
    if (value === undefined || value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Invalid Factory budget policy');
    }
    const keys = Object.keys(value);
    if (keys.length !== FACTORY_POLICY_FIELDS.size ||
        keys.some(key => !FACTORY_POLICY_FIELDS.has(key)) ||
        [...FACTORY_POLICY_FIELDS].some(key => !Object.hasOwn(value, key))) {
      throw new TypeError('Invalid Factory budget policy');
    }
    if (value.version !== FACTORY_POLICY_VERSION) {
      throw new TypeError('Unsupported Factory budget policy version');
    }
    const wanted = accountAlias(alias);
    if (accountAlias(value.accountAlias) !== wanted) return null;
    if (!FACTORY_STATUSES.has(value.status) || !FACTORY_SOURCES.has(value.source)) {
      throw new TypeError('Invalid Factory budget policy state');
    }
    if (typeof value.capacityFingerprint !== 'string' ||
        !FINGERPRINT.test(value.capacityFingerprint) ||
        typeof value.fingerprint !== 'string' ||
        !FINGERPRINT.test(value.fingerprint)) {
      throw new TypeError('Invalid Factory budget policy fingerprint');
    }

    const current = budgetClock(now);
    const observedAt = value.observedAt === null ? null : budgetClock(value.observedAt);
    const expiresAt = value.expiresAt === null ? null : budgetClock(value.expiresAt);

    if (value.status === 'UNKNOWN') {
      if (value.budget !== null || observedAt !== null || expiresAt !== null ||
          value.source !== 'conservative-default') {
        throw new TypeError('Invalid Factory UNKNOWN policy');
      }
      return null;
    }
    if (observedAt === null || expiresAt === null ||
        expiresAt <= observedAt ||
        expiresAt - observedAt > MAX_FACTORY_POLICY_TTL_MS) {
      throw new TypeError('Invalid Factory budget policy freshness');
    }
    if (observedAt > current) {
      throw new TypeError('Invalid Factory budget policy freshness');
    }
    if (value.status === 'STALE') {
      if (value.budget !== null || value.source !== 'conservative-default') {
        throw new TypeError('Invalid Factory STALE policy');
      }
      return null;
    }
    if (expiresAt <= current || value.budget === null) return null;
    if (value.source === 'conservative-default' ||
        !value.budget || typeof value.budget !== 'object' ||
        Array.isArray(value.budget)) {
      throw new TypeError('Invalid Factory FRESH policy');
    }
    const budgetKeys = Object.keys(value.budget);
    if (budgetKeys.length !== FACTORY_BUDGET_FIELDS.size ||
        budgetKeys.some(key => !FACTORY_BUDGET_FIELDS.has(key)) ||
        [...FACTORY_BUDGET_FIELDS].some(key => !Object.hasOwn(value.budget, key))) {
      throw new TypeError('Invalid Factory budget payload');
    }
    return normalizePolicy({
      limit: value.budget.limit,
      windowMs: value.budget.windowMs,
      minIntervalMs: value.budget.minIntervalMs,
      expiresAt
    }, 'factory');
  }

  function effectivePolicy(settings, remote, alias, now) {
    const local = localPolicy(settings);
    const learned = factoryPolicy(remote, alias, now);
    return learned || local;
  }

  function eventRows(value, type) {
    if (!Array.isArray(value) || value.length > MAX_EVENTS) {
      throw new TypeError('Invalid budget event collection');
    }
    return value.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          Object.keys(row).length !== 2 ||
          !Object.hasOwn(row, 'at') || !Object.hasOwn(row, 'reasoningLevel')) {
        throw new TypeError(`Invalid ${type} event`);
      }
      return {
        at: budgetClock(row.at),
        reasoningLevel: reasoningLevel(row.reasoningLevel)
      };
    });
  }

  function accountState(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Invalid account budget state');
    }
    if (Object.keys(value).some(key => !ACCOUNT_FIELDS.has(key))) {
      throw new TypeError('Invalid account budget state');
    }
    return {
      sends: eventRows(value.sends || [], 'send'),
      limits: eventRows(value.limits || [], 'limit'),
      blockedUntil: value.blockedUntil === undefined ? 0 : budgetClock(value.blockedUntil)
    };
  }

  function normalizeState(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Invalid budget state');
    }
    const rawAccounts = value.accounts === undefined ? {} : value.accounts;
    if (Object.keys(value).some(key => key !== 'accounts') ||
        !rawAccounts || typeof rawAccounts !== 'object' || Array.isArray(rawAccounts)) {
      throw new TypeError('Invalid budget state');
    }
    const accounts = {};
    for (const [alias, row] of Object.entries(rawAccounts)) {
      accounts[accountAlias(alias)] = accountState(row);
    }
    return { accounts };
  }

  function accountFor(state, alias, now, policy) {
    const normalized = normalizeState(state);
    const wanted = accountAlias(alias);
    const row = normalized.accounts[wanted] || accountState();
    normalized.accounts[wanted] = budgetPruneAccount(row, budgetClock(now), policy);
    return { state: normalized, row: normalized.accounts[wanted] };
  }

  function refresh(state, alias, policy, now) {
    const current = accountFor(state, alias, now, policy);
    return { state: current.state, snapshot: budgetSummary(current.row, policy, now) };
  }

  function snapshot(state, alias, policy, now) {
    return refresh(state, alias, policy, now).snapshot;
  }

  function consume(state, input = {}) {
    const now = budgetClock(input.now);
    const policy = normalizePolicy(input.policy, input.policy?.source || 'default');
    const current = accountFor(state, input.accountAlias, now, policy);
    const before = budgetSummary(current.row, policy, now);
    if (before.nextAllowedAt !== null || before.remaining <= 0) {
      return { state: current.state, allowed: false, snapshot: before };
    }
    current.row.sends.push({
      at: now,
      reasoningLevel: reasoningLevel(input.reasoningLevel)
    });
    return {
      state: current.state,
      allowed: true,
      snapshot: budgetSummary(current.row, policy, now)
    };
  }

  function recordLimit(state, input = {}) {
    const now = budgetClock(input.now);
    const policy = normalizePolicy(input.policy, input.policy?.source || 'default');
    const current = accountFor(state, input.accountAlias, now, policy);
    let blockedUntil = now + DEFAULT_UNKNOWN_LIMIT_PAUSE_MS;
    if (input.resetAt !== undefined && input.resetAt !== null) {
      const resetAt = budgetClock(input.resetAt);
      if (resetAt > now) blockedUntil = resetAt;
    }
    current.row.blockedUntil = Math.max(current.row.blockedUntil, blockedUntil);
    current.row.limits.push({
      at: now,
      reasoningLevel: reasoningLevel(input.reasoningLevel)
    });
    if (current.row.limits.length > MAX_EVENTS) current.row.limits.shift();
    return {
      state: current.state,
      snapshot: budgetSummary(current.row, policy, now)
    };
  }

  return Object.freeze({
    STATE_KEY,
    SNAPSHOT_KEY,
    FACTORY_POLICY_KEY,
    FACTORY_POLICY_VERSION,
    DEFAULT_ACCOUNT_ALIAS,
    DEFAULT_LIMIT,
    DEFAULT_WINDOW_MS,
    DEFAULT_UNKNOWN_LIMIT_PAUSE_MS,
    MAX_FACTORY_POLICY_TTL_MS,
    MAX_EVENTS,
    accountAlias,
    normalizePolicy,
    localPolicy,
    factoryPolicy,
    effectivePolicy,
    normalizeState,
    refresh,
    consume,
    recordLimit,
    snapshot
  });
});
