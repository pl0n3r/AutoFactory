(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryKillSwitch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Offline coordination contract only: consumers must supply fakes or trusted
  // adapters and enforce a separate activation/legal gate. Never opens a bridge.
  function createFactoryControlKillSwitch({
    executeCommand, stopBridge, revokePairing, restoreSafeState, now = Date.now,
    rollbackTimeoutMs = 10000
  } = {}) {
    if ([executeCommand, stopBridge, revokePairing, restoreSafeState, now]
      .some(value => typeof value !== 'function')) {
      throw new TypeError('Kill switch dependencies are required');
    }
    // A hung adapter must never leave the public rollback result pending forever.
    if (!Number.isSafeInteger(rollbackTimeoutMs) ||
        rollbackTimeoutMs < 1 || rollbackTimeoutMs > 60000) {
      throw new TypeError('Kill switch rollback timeout must be 1-60000 ms');
    }
    let stopped = false;
    let stopPromise = null;
    const inflight = new Set();
    let publicEvidence = null;

    function response(ok, code) {
      return Object.freeze({ ok, code });
    }

    async function dispatch(command) {
      if (stopped) return response(false, 'stopped');
      const controller = new AbortController();
      inflight.add(controller);
      try {
        // Only injected adapters see commands; no payload is ever returned/logged.
        const outcome = await executeCommand(command, { signal: controller.signal });
        if (stopped || controller.signal.aborted) return response(false, 'stopped');
        return outcome === true ? response(true, 'handled') : response(false, 'failed');
      } catch (_error) {
        // Intentionally discard untrusted adapter exceptions: never echo chat contents.
        return response(false, stopped ? 'stopped' : 'failed');
      } finally {
        inflight.delete(controller);
      }
    }

    function kill() {
      if (stopPromise) return stopPromise;
      // Synchronous terminal fence comes BEFORE abort callbacks or adapters.
      stopped = true;
      // Install a stable promise before abort listeners can re-enter kill().
      let resolveStop;
      stopPromise = new Promise(resolve => { resolveStop = resolve; });
      const controllers = [...inflight];
      for (const controller of controllers) controller.abort();
      const abortedCount = controllers.length;

      // Once terminal, late adapters can never replace the fail-closed result.
      let settled = false;
      let deadline;
      function settle(bridgeStopped, pairingRevoked, restored, at) {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        publicEvidence = Object.freeze({
          // Abort requests are advisory: active effects need external reconciliation.
          // Never certify safe while a command was in flight at the kill boundary.
          status: bridgeStopped && pairingRevoked && restored && at !== null &&
            abortedCount === 0 ? 'safe' : 'rollback_failed',
          bridgeStopped, pairingRevoked, restored,
          abortedCommands: abortedCount, observedAt: at
        });
        resolveStop(publicEvidence);
      }
      // An unresponsive adapter is UNKNOWN, never proof of successful rollback.
      deadline = setTimeout(() => settle(false, false, false, null), rollbackTimeoutMs);
      // Call both independently: stop failures do not skip revocation.
      function invoke(adapter) {
        try { return Promise.resolve(adapter()).then(value => value === true, () => false); }
        catch (_error) { return Promise.resolve(false); }
      }
      const stop = invoke(stopBridge);
      const revoke = invoke(revokePairing);
      Promise.all([stop, revoke]).then(async ([bridgeStopped, pairingRevoked]) => {
        if (settled) return;
        const restored = await invoke(restoreSafeState);
        if (settled) return;
        let at = null;
        try {
          const timestamp = now();
          if (Number.isSafeInteger(timestamp) && timestamp >= 0) at = timestamp;
        } catch (_error) { /* Keep evidence static; never echo adapter messages. */ }
        settle(bridgeStopped, pairingRevoked, restored, at);
      }).catch(() => {
        // Never echo exception payloads from a hostile adapter.
        settle(false, false, false, null);
      });
      return stopPromise;
    }

    function status() {
      return Object.freeze({ stopped, code: !stopped ? 'not_triggered' :
        (publicEvidence?.status ?? 'stopping') });
    }

    return Object.freeze({ dispatch, kill, status });
  }

  return Object.freeze({ createFactoryControlKillSwitch });
});
