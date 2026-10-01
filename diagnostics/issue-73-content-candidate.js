'use strict';

// Diagnostic-only copy for issue #73. This file is never imported by the extension.
// It preserves the v1.6.8 recovery/circuit-breaker control flow while using the
// parser already corrected by #71, so SonarCloud evaluates the remaining block
// independently as New Code.
function probeRecoveryControlFlow({
  core,
  document,
  location,
  sessionStorage,
  state,
  reliability,
  runtimeSnapshot,
  persistRuntime,
  saveLearning,
  setStatus,
  log,
  recoverableState,
  recoverableStateKey
}) {
  const signal = core.pageSignal(document);
  if (core.isSafeRecoverySignal(signal)
      && Date.now() - state.lastRecoveryAt > 10000) {
    const previous = recoverableState(
      sessionStorage.getItem(recoverableStateKey)
    );
    const attempts = previous.path === location.pathname
      ? Math.max(0, Number(previous.attempts) || 0) + 1 : 1;
    sessionStorage.setItem(recoverableStateKey, JSON.stringify({
      path: location.pathname, attempts
    }));
    const escalation = core.recoverableEscalation(attempts);
    state.lastRecoveryAt = Date.now();
    state.circuitOpenUntil = 0;
    state.consecutiveFailures = 0;
    state.waiting = escalation === 'retry';
    state.sawGeneration = false;
    state.assistantCountBeforeSend = core.assistantMessageCount(document);
    state.lastRecovery = { code: signal.code, action: escalation };
    persistRuntime();
    saveLearning('recovery');
    saveLearning('error', 0, { code: signal.code });
    if (escalation === 'retry') {
      signal.element.click();
      setStatus(`Conversación no disponible; reintento ${attempts}/2`);
    } else if (escalation === 'reload') {
      setStatus('Conversación no disponible; recarga controlada');
      location.reload();
    } else {
      sessionStorage.removeItem(recoverableStateKey);
      state.pendingSignature = '';
      state.lastSentAt = 0;
      state.nextSendAt = Date.now() + 5000;
      persistRuntime();
      setStatus('Conversación inaccesible; continuando en un chat nuevo');
      location.assign('https://chatgpt.com/');
    }
    log('recovery', {
      code: signal.code,
      action: escalation,
      attempts,
      priority: 'circuit-bypass'
    });
    return { handled: true, signal };
  }

  if (signal.code !== 'recoverable') {
    sessionStorage.removeItem(recoverableStateKey);
  }
  if (Date.now() < state.circuitOpenUntil
      && core.stopButton(document)
      && core.interruptedConnection(document)) {
    Object.assign(state, reliability.afterSuccess(runtimeSnapshot()));
    state.reloadAttempts = 0;
    state.reloadWindowStartedAt = 0;
    persistRuntime();
    log('circuit-reset', { reason: 'active-interrupted-generation' });
  }
  if (Date.now() < state.circuitOpenUntil) {
    setStatus(
      `Protección activa; reintento en ${Math.ceil((state.circuitOpenUntil - Date.now()) / 60000)} min`,
      'error'
    );
    return { handled: true, signal };
  }

  return { handled: false, signal };
}

module.exports = { probeRecoveryControlFlow };
