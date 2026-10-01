'use strict';

// Diagnostic-only copy for issue #73. This file is not imported by the extension.
// It intentionally preserves the v1.6.8 helper logic so SonarCloud evaluates
// these lines as New Code without changing runtime behavior.
function isSafeRecoverySignal(signal) {
  return Boolean(
    signal
      && signal.code === 'recoverable'
      && signal.action === 'click-recovery'
      && signal.element
  );
}

function recoverableEscalation(attempts) {
  const count = Math.max(0, Number(attempts) || 0);
  if (count <= 2) return 'retry';
  if (count === 3) return 'reload';
  return 'new-chat';
}

module.exports = { isSafeRecoverySignal, recoverableEscalation };
