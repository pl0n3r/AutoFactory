(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryKillSwitch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Offline coordination contract only: consumers must supply fakes or trusted
  // adapters and enforce a separate activation/legal gate. Never opens a bridge.
  function createFactoryControlKillSwitch({
    executeCommand, stopBridge, revokePairing, restoreSafeState, now = Date.now
  } = {}) {
    if ([executeCommand, stopBridge, revokePairing, restoreSafeState, now]
      .some(value => typeof value !== 'function')) {
      throw new TypeError('Kill switch dependencies are required');
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

      // Call both independently: an exception in the stop adapter cannot skip
      // pairing revocation. Complete rollback even when one operation fails.
      function invoke(adapter) {
        try { return Promise.resolve(adapter()).then(value => value === true, () => false); }
        catch (_error) { return Promise.resolve(false); }
      }
      const stop = invoke(stopBridge);
      const revoke = invoke(revokePairing);
      Promise.all([stop, revoke]).then(async ([bridgeStopped, pairingRevoked]) => {
        const restored = await invoke(restoreSafeState);
        const safe = bridgeStopped && pairingRevoked && restored;
        let at = null;
        try {
          const timestamp = now();
          if (Number.isSafeInteger(timestamp) && timestamp >= 0) at = timestamp;
        } catch (_error) { /* Keep evidence static; never echo adapter messages. */ }
        publicEvidence = Object.freeze({
          status: safe && at !== null ? 'safe' : 'rollback_failed',
          bridgeStopped, pairingRevoked, restored,
          abortedCommands: abortedCount, observedAt: at
        });
        return publicEvidence;
      }).then(resolveStop);
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
