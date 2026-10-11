'use strict';
const assert = require('node:assert/strict');
const { createFactoryControlKillSwitch } = require('./factory-control-kill-switch.js');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function setup(overrides = {}) {
  const calls = [];
  const switcher = createFactoryControlKillSwitch({
    now: overrides.now || (() => 1_800_000_000_000),
    rollbackTimeoutMs: overrides.rollbackTimeoutMs,
    executeCommand: overrides.executeCommand || (async () => true),
    stopBridge: overrides.stopBridge || (() => { calls.push('stop'); return true; }),
    revokePairing: overrides.revokePairing || (() => { calls.push('revoke'); return true; }),
    restoreSafeState: overrides.restoreSafeState || (() => { calls.push('rollback'); return true; })
  });
  return { switcher, calls };
}

(async () => {
  // AC-01: kill wins over an in-flight command, including an adapter that
  // ignores the abort signal and returns a successful result after shutdown.
  const pending = deferred();
  let signal;
  let adapterCalls = 0;
  let effectsAfterStop = 0;
  const first = setup({
    executeCommand: async (_command, context) => {
      adapterCalls++;
      signal = context.signal;
      await pending.promise;
      // Deliberately non-cooperative fake: side effect after abort.
      if (context.signal.aborted) effectsAfterStop++;
      return true;
    }
  });
  const inFlight = first.switcher.dispatch({ token: 'DONT_LOG_ME' });
  const killing = first.switcher.kill();
  assert.equal(first.switcher.status().stopped, true);
  assert.equal(signal.aborted, true);
  assert.deepEqual(await first.switcher.dispatch({ token: 'DONT_LOG_ME' }),
    { ok: false, code: 'stopped' });
  assert.equal(adapterCalls, 1);
  // All rollback adapters can confirm local work while in-flight effects remain
  // UNKNOWN; request-to-abort is never proof of remote cancellation.
  const evidence = await killing;
  assert.deepEqual(evidence, {
    status: 'rollback_failed', bridgeStopped: true, pairingRevoked: true,
    restored: true, abortedCommands: 1, observedAt: 1_800_000_000_000
  });
  assert.equal(effectsAfterStop, 0);
  pending.resolve();
  assert.deepEqual(await inFlight, { ok: false, code: 'stopped' });
  assert.equal(effectsAfterStop, 1, 'synthetic non-cooperative late effect');
  assert.equal(first.switcher.status().code, 'rollback_failed');
  assert.deepEqual(first.switcher.kill(), killing);
  assert.deepEqual(first.calls, ['stop', 'revoke', 'rollback']);
  assert.equal(first.switcher.kill(), killing, 'kill is idempotent');
  assert.equal(JSON.stringify(evidence).includes('DONT_LOG_ME'), false);
  console.log('AF157-AC01-ABORT-INFLIGHT-OK');

  // AC-02: a failed adapter still invokes revoke/rollback; the terminal
  // fence remains set and a secret embedded in a failure is never echoed.
  const fallback = setup({
    stopBridge() { throw new Error('PRIVATE-TOKEN'); },
    now: () => { throw new Error('PRIVATE-TOKEN'); }
  });
  const failed = await fallback.switcher.kill();
  assert.equal(failed.status, 'rollback_failed');
  assert.equal(failed.bridgeStopped, false);
  assert.deepEqual(fallback.calls, ['revoke', 'rollback']);
  assert.equal(JSON.stringify(failed).includes('PRIVATE-TOKEN'), false);
  assert.deepEqual(await fallback.switcher.dispatch({}), { ok: false, code: 'stopped' });
  console.log('AF157-AC02-ROLLBACK-REDACTED-OK');

  // AC-03: rollback reaches a terminal safe state, without reopening the
  // bridge or allowing later work even after an attempted second kill.
  const restored = setup();
  assert.deepEqual(await restored.switcher.dispatch({ token: 'PRIVATE-CHAT' }),
    { ok: true, code: 'handled' });
  assert.equal(restored.switcher.status().code, 'not_triggered');
  assert.equal((await restored.switcher.kill()).status, 'safe');
  assert.equal(restored.switcher.status().code, 'safe');
  assert.deepEqual(await restored.switcher.dispatch({ token: 'PRIVATE-CHAT' }),
    { ok: false, code: 'stopped' });
  assert.deepEqual(restored.calls, ['stop', 'revoke', 'rollback']);
  assert.equal(JSON.stringify(restored.switcher.status()).includes('PRIVATE-CHAT'), false);

  // Abort callbacks can re-enter the module synchronously. The terminal
  // fence must already be set before delivering that callback.
  let reentrant;
  let reentrantKill;
  const race = setup({ executeCommand: async (_command, { signal }) => {
    signal.addEventListener('abort', () => {
      reentrantKill = race.switcher.kill();
      reentrant = race.switcher.dispatch({ token: 'PRIVATE-CHAT' });
    });
    return pending.promise;
  }});
  const racing = race.switcher.dispatch({});
  const raceKill = race.switcher.kill();
  assert.equal(reentrantKill, raceKill);
  await raceKill;
  assert.deepEqual(await Promise.resolve(reentrant), { ok: false, code: 'stopped' });
  assert.deepEqual(await racing, { ok: false, code: 'stopped' });
  console.log('AF157-AC03-NO-NEW-COMMANDS-OK');

  // Unexpected rejection in the kill chain must resolve fail-closed, not hang.
  const originalAll = Promise.all;
  const rejectedChain = setup();
  let rejectedPromise;
  try {
    Promise.all = () => Promise.reject(new Error('PRIVATE-TOKEN'));
    rejectedPromise = rejectedChain.switcher.kill();
  } finally {
    Promise.all = originalAll;
  }
  const failedChain = await rejectedPromise;
  assert.equal(failedChain.status, 'rollback_failed');
  assert.equal(failedChain.bridgeStopped, false);
  assert.equal(failedChain.restored, false);
  assert.equal(rejectedChain.switcher.status().stopped, true);
  assert.deepEqual(await rejectedChain.switcher.dispatch({ token: 'PRIVATE-CHAT' }),
    { ok: false, code: 'stopped' });
  assert.equal(JSON.stringify(failedChain).includes('PRIVATE-TOKEN'), false);

  // A hung adapter may not keep kill() pending forever. The timer reports
  // an irreversible fail-closed result, even if the adapter resolves later.
  const held = deferred();
  const hung = setup({
    stopBridge: () => held.promise,
    rollbackTimeoutMs: 15
  });
  const hungKill = hung.switcher.kill();
  assert.equal(hung.switcher.status().stopped, true);
  assert.equal((await hungKill).status, 'rollback_failed');
  assert.equal(hung.switcher.status().code, 'rollback_failed');
  assert.deepEqual(await hung.switcher.dispatch({ token: 'PRIVATE-CHAT' }),
    { ok: false, code: 'stopped' });
  held.resolve(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hung.switcher.status().code, 'rollback_failed');
  assert.equal(hung.switcher.kill(), hungKill);
  assert.equal(JSON.stringify(await hungKill).includes('PRIVATE-CHAT'), false);

  // Restore itself may hang; its eventual result cannot undo the timeout.
  const lateRestore = deferred();
  const restoring = setup({
    restoreSafeState: () => lateRestore.promise,
    rollbackTimeoutMs: 15
  });
  const restoreKill = restoring.switcher.kill();
  assert.equal((await restoreKill).status, 'rollback_failed');
  lateRestore.resolve(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(restoring.switcher.status().code, 'rollback_failed');
  assert.deepEqual(await restoring.switcher.dispatch({}),
    { ok: false, code: 'stopped' });
  for (const invalid of [0, -1, Infinity, NaN, 60001, '1']) {
    assert.throws(() => setup({ rollbackTimeoutMs: invalid }), TypeError);
  }

  assert.throws(() => createFactoryControlKillSwitch(), TypeError);
  console.log('AF157-KILL-SWITCH-ROLLBACK-OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
