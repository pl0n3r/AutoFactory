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

  function alias(value) {
    return typeof value === 'string' && value.trim() === value &&
      value.length > 0 && value.length <= 64 &&
      !/[@\r\n\x00-\x1f]/.test(value);
  }
  function permitted(consent, time) {
    return consent && typeof consent === 'object' &&
      !Array.isArray(consent) &&
      Object.keys(consent).length === 4 &&
      ['profileAlias', 'enabled', 'revoked', 'expiresAt']
        .every(field => Object.hasOwn(consent, field)) &&
      alias(consent.profileAlias) && consent.enabled === true &&
      consent.revoked === false && Number.isSafeInteger(consent.expiresAt) &&
      consent.expiresAt > time && consent.expiresAt <= time + MAX_CONSENT_MS;
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
      try {
        started = now();
      } catch (_error) {
        return 'failed';
      }
      if (!Number.isSafeInteger(started) || started < 0) return 'failed';
      if (lastAttemptAt !== null && started - lastAttemptAt < MIN_INTERVAL_MS) {
        return 'throttled';
      }
      inFlight = true;
      lastAttemptAt = started; // Failures must not start a retry storm.
      try {
        const consent = await loadVerifiedConsent();
        if (!permitted(consent, started) || consent.profileAlias !== profileAlias ||
            stopped) return 'denied';
        const payload = protocol.heartbeat(await snapshot());
        if (payload.profileAlias !== consent.profileAlias || stopped) return 'denied';
        // A revocation while the snapshot was gathered must prevent delivery.
        const latest = await loadVerifiedConsent();
        // Check the clock AFTER storage resolves, immediately before delivery.
        const current = now();
        if (!Number.isSafeInteger(current) || current < started ||
            !permitted(latest, current) ||
            latest.profileAlias !== profileAlias || stopped) return 'denied';
        await deliver(payload);
        return 'sent';
      } catch (_error) {
        // No provider errors, tokens, account aliases or chat text in results.
        return 'failed';
      } finally {
        inFlight = false;
      }
    }
    function stop() {
      stopped = true;
      // An already started network delivery cannot be aborted here. The
      // runtime must supply its own abort signal when connecting a transport.
    }
    return Object.freeze({ tick, stop });
  }
  return Object.freeze({ MIN_INTERVAL_MS, createHeartbeatCoordinator });
});
