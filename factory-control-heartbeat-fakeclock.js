'use strict';

// Explicit, manual-clock bridge contract: no browser integration or remote delivery.
const {
  MIN_INTERVAL_MS,
  OFFLINE_AFTER_MISSES,
  createHeartbeatPresenceCoordinator
} = require('./factory-control-heartbeat.js');

const MAX_BACKOFF_MS = 4 * MIN_INTERVAL_MS;
const PORTS = ['startAt', 'profileAlias', 'loadVerifiedConsent', 'snapshot', 'deliver'];

function exactObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key) &&
      Object.prototype.propertyIsEnumerable.call(value, key)) &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key));
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function createManualClock(startAt) {
  if (!nonnegativeInteger(startAt) || startAt > Number.MAX_SAFE_INTEGER - MAX_BACKOFF_MS) {
    throw new TypeError('Invalid synthetic start time');
  }
  let time = startAt;
  function advance(deltaMs) {
    if (!nonnegativeInteger(deltaMs) ||
        deltaMs > Number.MAX_SAFE_INTEGER - MAX_BACKOFF_MS - time) {
      throw new RangeError('Invalid synthetic time advance');
    }
    time += deltaMs;
    return time;
  }
  return Object.freeze({ now: () => time, advance });
}

/**
 * Purely synthetic wrapper of the already-merged heartbeat coordinator.
 * Acknowledgements are bound to each fake attempt (not to a live transport).
 */
function createHeartbeatFakeclockSimulation(ports) {
  if (!exactObject(ports, PORTS) ||
      typeof ports.profileAlias !== 'string' ||
      typeof ports.loadVerifiedConsent !== 'function' ||
      typeof ports.snapshot !== 'function' ||
      typeof ports.deliver !== 'function') {
    throw new TypeError('Invalid synthetic heartbeat ports');
  }

  const clock = createManualClock(ports.startAt);
  let nextEligibleAt = ports.startAt;
  let failures = 0;
  let attempts = 0;
  let deliveries = 0;
  let lastAcceptedAttempt = 0;
  let blocked = false;
  let stopped = false;
  let running = false;

  const coordinator = createHeartbeatPresenceCoordinator({
    now: clock.now,
    profileAlias: ports.profileAlias,
    loadVerifiedConsent: ports.loadVerifiedConsent,
    snapshot: ports.snapshot,
    deliver: async payload => {
      deliveries += 1;
      const attemptId = deliveries;
      const receipt = await ports.deliver(payload, Object.freeze({ attemptId }));
      if (!exactObject(receipt, ['confirmed', 'attemptId']) ||
          receipt.confirmed !== true ||
          receipt.attemptId !== attemptId ||
          attemptId <= lastAcceptedAttempt) {
        return Object.freeze({ confirmed: false });
      }
      lastAcceptedAttempt = attemptId;
      return Object.freeze({ confirmed: true });
    }
  });

  function presence() {
    const state = coordinator.presence();
    const observed = blocked ? 'unknown' :
      state.state === 'online' && state.missedIntervals > 0 ? 'stale' : state.state;
    return Object.freeze({
      state: observed,
      lastConfirmedAt: blocked ? null : state.lastConfirmedAt,
      missedIntervals: state.missedIntervals,
      nextEligibleAt,
      consecutiveFailures: failures,
      attemptedTicks: attempts,
      fakeDeliveries: deliveries
    });
  }

  async function tick() {
    if (stopped) return Object.freeze({ outcome: 'stopped', presence: presence() });
    if (running) return Object.freeze({ outcome: 'busy', presence: presence() });
    const started = clock.now();
    if (started < nextEligibleAt) {
      return Object.freeze({ outcome: 'waiting', presence: presence() });
    }
    running = true;
    try {
      const outcome = await coordinator.tick();
      if (outcome === 'sent') {
        failures = 0;
        blocked = false;
      } else if (outcome === 'denied' || outcome === 'failed') {
        failures = Math.min(failures + 1, 31);
        if (outcome === 'denied') blocked = true;
      } else if (outcome !== 'throttled' && outcome !== 'busy') {
        // Unknown outcomes from a future coordinator must not authorize presence.
        failures = Math.min(failures + 1, 31);
        blocked = true;
      }

      attempts += 1;
      const delay = outcome === 'sent' ? MIN_INTERVAL_MS :
        Math.min(MAX_BACKOFF_MS, MIN_INTERVAL_MS * 2 ** Math.min(failures - 1, 2));
      const current = clock.now();
      if (!nonnegativeInteger(current) ||
          current < started ||
          current > Number.MAX_SAFE_INTEGER - delay) {
        stopped = true;
        blocked = true;
        coordinator.stop();
        return Object.freeze({ outcome: 'failed', presence: presence() });
      }
      nextEligibleAt = current + delay;
      return Object.freeze({ outcome, presence: presence() });
    } finally {
      running = false;
    }
  }

  function advance(deltaMs) {
    clock.advance(deltaMs);
    return presence();
  }

  function stop() {
    stopped = true;
    blocked = true;
    coordinator.stop();
    return presence();
  }

  return Object.freeze({
    now: clock.now, advance, presence, tick, stop,
    intervalMs: MIN_INTERVAL_MS,
    offlineAfterMisses: OFFLINE_AFTER_MISSES,
    maximumBackoffMs: MAX_BACKOFF_MS
  });
}

module.exports = Object.freeze({
  createManualClock, createHeartbeatFakeclockSimulation,
  MIN_INTERVAL_MS, OFFLINE_AFTER_MISSES, MAX_BACKOFF_MS
});
