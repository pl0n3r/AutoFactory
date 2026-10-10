(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./factory-control-protocol.js')
      : root.ChatGPTAutopilotFactoryProtocol
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryHeartbeat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (protocol) {
  'use strict';

  const MIN_INTERVAL_MS = 60000;
  const MAX_CONSENT_MS = 86400000;
  const PURPOSE = 'heartbeat';
  const BUDGET_FIELDS = [
    'windowMs', 'budget', 'sent', 'remaining', 'limitEvents',
    'highReasoningSends', 'nextAllowedAt', 'source'
  ];

  function alias(value) {
    return typeof value === 'string' && value.trim() === value &&
      value.length > 0 && value.length <= 64 &&
      !/[@\r\n\x00-\x1f]/.test(value);
  }
  function permitted(consent, time) {
    return consent && typeof consent === 'object' &&
      !Array.isArray(consent) &&
      Object.keys(consent).length === 5 &&
      ['profileAlias', 'purpose', 'enabled', 'revoked', 'expiresAt']
        .every(field => Object.hasOwn(consent, field)) &&
      alias(consent.profileAlias) && consent.purpose === PURPOSE &&
      consent.enabled === true &&
      consent.revoked === false && Number.isSafeInteger(consent.expiresAt) &&
      consent.expiresAt > time && consent.expiresAt <= time + MAX_CONSENT_MS;
  }

  function exactEnumerableObject(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === fields.length &&
      ownKeys.every(key => typeof key === 'string' && fields.includes(key)) &&
      fields.every(key => Object.hasOwn(value, key) &&
        Object.prototype.propertyIsEnumerable.call(value, key));
  }

  function buildHeartbeatSnapshot(input) {
    if (!protocol || typeof protocol.heartbeat !== 'function') {
      throw new TypeError('Heartbeat snapshot dependencies are required');
    }
    const baseFields = ['profileAlias', 'accountAlias', 'tabs', 'lastEvent', 'accountState'];
    const budgetFields = [...baseFields, 'messageBudget'];
    const hasBudget = exactEnumerableObject(input, budgetFields);
    if (!hasBudget && !exactEnumerableObject(input, baseFields)) {
      throw new TypeError('Heartbeat snapshot input is invalid');
    }

    const rawAccountState = input.accountState;
    if (!exactEnumerableObject(rawAccountState, ['state', 'resetAt'])) {
      throw new TypeError('Heartbeat snapshot input is invalid');
    }
    const rawBudget = hasBudget ? input.messageBudget : undefined;
    if (hasBudget && !exactEnumerableObject(rawBudget, BUDGET_FIELDS)) {
      throw new TypeError('Heartbeat snapshot input is invalid');
    }

    const profileAlias = input.profileAlias;
    const accountAlias = input.accountAlias;
    const tabs = input.tabs;
    const lastEvent = input.lastEvent;
    const state = rawAccountState.state;
    const resetAt = rawAccountState.resetAt;
    const messageBudget = hasBudget ? {
      windowMs: rawBudget.windowMs,
      budget: rawBudget.budget,
      sent: rawBudget.sent,
      remaining: rawBudget.remaining,
      limitEvents: rawBudget.limitEvents,
      highReasoningSends: rawBudget.highReasoningSends,
      nextAllowedAt: rawBudget.nextAllowedAt,
      source: rawBudget.source
    } : undefined;

    if (!(hasBudget ? exactEnumerableObject(input, budgetFields) : exactEnumerableObject(input, baseFields)) ||
        !exactEnumerableObject(rawAccountState, ['state', 'resetAt']) ||
        (hasBudget && !exactEnumerableObject(rawBudget, BUDGET_FIELDS))) {
      throw new TypeError('Heartbeat snapshot input changed during read');
    }

    const payload = {
      profileAlias,
      accountAlias,
      tabs,
      lastEvent,
      accountState: { state, resetAt }
    };
    if (hasBudget) payload.messageBudget = messageBudget;
    return Object.freeze(protocol.heartbeat(payload));
  }

  function createHeartbeatCoordinator({ loadVerifiedConsent, snapshot, deliver, now, profileAlias } = {}) {
    if (!protocol || typeof protocol.heartbeat !== 'function' ||
        typeof loadVerifiedConsent !== 'function' || typeof snapshot !== 'function' ||
        typeof deliver !== 'function' || typeof now !== 'function' ||
        !alias(profileAlias)) {
      throw new TypeError('Heartbeat requires verified consent, snapshot, delivery and clock');
    }
    let stopped = false;
    let inFlight = false;
    let lastAttemptAt = null;
    async function tick() {
      if (stopped) return 'stopped';
      if (inFlight) return 'busy';
      let started;
      try { started = now(); } catch (_error) { return 'failed'; }
      if (!Number.isSafeInteger(started) || started < 0) return 'failed';
      if (lastAttemptAt !== null && started - lastAttemptAt < MIN_INTERVAL_MS) return 'throttled';
      inFlight = true;
      lastAttemptAt = started;
      try {
        const consent = await loadVerifiedConsent();
        if (!permitted(consent, started) || consent.profileAlias !== profileAlias || stopped) return 'denied';
        const payload = protocol.heartbeat(await snapshot());
        if (payload.profileAlias !== consent.profileAlias || stopped) return 'denied';
        const latest = await loadVerifiedConsent();
        const current = now();
        if (!Number.isSafeInteger(current) || current < started ||
            !permitted(latest, current) || latest.profileAlias !== profileAlias || stopped) return 'denied';
        await deliver(payload);
        return 'sent';
      } catch (_error) {
        return 'failed';
      } finally {
        inFlight = false;
      }
    }
    function stop() { stopped = true; }
    return Object.freeze({ tick, stop });
  }

  // Read-only evidence derived solely from successful, acknowledged fake transport.
  // No timers, polling, network access or connection to Production Authority.
  const OFFLINE_AFTER_MISSES = 3;

  function createHeartbeatPresenceCoordinator(config = {}) {
    const { now, deliver, ...rest } = config;
    if (typeof now !== 'function' || typeof deliver !== 'function') {
      throw new TypeError('Heartbeat presence dependencies are required');
    }
    let stopped = false;
    let firstAttemptAt = null;
    let lastConfirmedAt = null;
    let lastClockAt = null;

    function clock() {
      let current;
      try { current = now(); } catch (_error) { return null; }
      if (!Number.isSafeInteger(current) || current < 0 ||
          (lastClockAt !== null && current < lastClockAt)) return null;
      lastClockAt = current;
      return current;
    }

    const coordinator = createHeartbeatCoordinator({
      ...rest, now,
      deliver: async payload => {
        const receipt = await deliver(payload);
        // Missing/ambiguous acknowledgement is not proof of presence.
        if (!exactEnumerableObject(receipt, ['confirmed']) ||
            receipt.confirmed !== true) {
          throw new TypeError('Heartbeat delivery not confirmed');
        }
      }
    });

    async function tick() {
      if (stopped) return 'stopped';
      const started = clock();
      if (started === null) return 'failed';
      if (firstAttemptAt === null) firstAttemptAt = started;
      const outcome = await coordinator.tick();
      if (outcome === 'sent') {
        const finished = clock();
        if (finished === null) return 'failed';
        lastConfirmedAt = finished;
      }
      return outcome;
    }

    function presence() {
      if (stopped) {
        return Object.freeze({ state: 'offline', lastConfirmedAt: null, missedIntervals: 0 });
      }
      const current = clock();
      if (current === null) {
        return Object.freeze({ state: 'unknown', lastConfirmedAt: null, missedIntervals: 0 });
      }
      const anchor = lastConfirmedAt === null ? firstAttemptAt : lastConfirmedAt;
      if (anchor === null || anchor > current) {
        return Object.freeze({ state: 'unknown', lastConfirmedAt: null, missedIntervals: 0 });
      }
      const missed = Math.floor((current - anchor) / MIN_INTERVAL_MS);
      const state = missed >= OFFLINE_AFTER_MISSES ? 'offline'
        : lastConfirmedAt === null ? 'unknown' : 'online';
      return Object.freeze({
        state, lastConfirmedAt, missedIntervals: Math.min(missed, OFFLINE_AFTER_MISSES)
      });
    }

    function stop() {
      stopped = true;
      coordinator.stop();
    }
    return Object.freeze({ tick, presence, stop });
  }

  return Object.freeze({ PURPOSE, MIN_INTERVAL_MS, OFFLINE_AFTER_MISSES, buildHeartbeatSnapshot, createHeartbeatCoordinator, createHeartbeatPresenceCoordinator });
});
