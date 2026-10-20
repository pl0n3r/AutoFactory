"""#226: contract-only, synthetic offline session-denial acceptance tests.

Every assertion uses the existing pure Node contracts. No browser session,
provider, token, network request or extension permission is exercised.
"""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]

NODE_HARNESS = r"""
'use strict';
const assert = require('node:assert/strict');
const { evaluate } = require('./factory-control-session-keepalive.js');
const { classifyAccountState, classifyProviderPageSignal } =
  require('./factory-control-account-state.js');
const NOW = 10000;
function snapshot() {
  return {
    chat: {
      reservation_active: true, reply_complete: true,
      last_prompt_s: 9100, last_reply_s: 9200,
      last_activity_s: 9300, last_reply_chars: 37,
      msgs_hour: 3, state: 'inactivo', identical_read_count: 2
    },
    account: { observed_limit_hour: 40, msgs_hour: 10, usage_limited: false },
    controls: {
      enabled: true, manual_pause: false, kill_switch_running: true,
      circuit_breaker_open: false, ambiguous_send: false, session_closed: false
    },
    history: { retries_s: [] }
  };
}
function denial() {
  assert.equal(evaluate(snapshot(), NOW).action, 'reenganchar');
  const denials = [
    [s => { s.controls.session_closed = true; }, 'sesion_cerrada'],
    [s => { s.chat.state = 'cerrado'; }, 'sesion_cerrada'],
    [s => { s.account.usage_limited = true; }, 'limite_horario'],
    [s => { s.account.msgs_hour = 32; }, 'limite_horario'],
    [s => { s.controls.kill_switch_running = false; }, 'pausa_manual'],
    [s => { s.controls.enabled = false; }, 'pausa_manual'],
    [s => { s.chat.state = 'UNKNOWN'; }, 'desconocido'],
    [s => { s.chat.last_activity_s = NOW + 1; }, 'desconocido'],
    [s => { s.chat.identical_read_count = 1; }, 'desconocido'],
    [s => { s.account.observed_limit_hour = 0; }, 'desconocido']
  ];
  for (const [mutate, reason] of denials) {
    const candidate = snapshot();
    mutate(candidate);
    const observed = evaluate(candidate, NOW);
    assert.equal(observed.action, 'detener', reason);
    assert.equal(observed.idle_reason, reason);
    assert.equal(observed.continuation, null);
  }
  const awaiting = snapshot();
  awaiting.chat.reply_complete = false;
  assert.equal(evaluate(awaiting, NOW).action, 'esperar');
  const stale = snapshot();
  stale.chat.last_prompt_s = 9500;
  assert.deepEqual(
    [evaluate(stale, NOW).action, evaluate(stale, NOW).idle_reason],
    ['detener', 'desconocido']
  );
  const clock = () => NOW;
  const valid = { authenticated: true, usageLimited: false,
    providerError: false, resetAt: null };
  assert.equal(classifyAccountState(valid, clock).state, 'ready');
  assert.equal(classifyAccountState({ ...valid, resetAt: NOW - 1 }, clock).state, 'unknown');
  assert.equal(classifyAccountState({ ...valid, usageLimited: true,
    resetAt: NOW - 1 }, clock).state, 'unknown');
  assert.equal(classifyProviderPageSignal({
    signalCode: 'rate-limit', alertText: null
  }, clock).state, 'limit');
  assert.equal(classifyProviderPageSignal({
    signalCode: 'ready', alertText: 'stale UI signal'
  }, clock).state, 'unknown');
}
function diagnostics() {
  const candidate = snapshot();
  const secrets = [
    'SYNTHETIC_CHAT_TEXT_DO_NOT_COPY',
    'synthetic.person@example.invalid',
    'SYNTHETIC_TOKEN_NEVER_ECHO',
    'conversation-id-synthetic-000'
  ];
  candidate.chat.message = secrets[0];
  candidate.chat.conversation_id = secrets[3];
  candidate.account.email = secrets[1];
  candidate.controls.auth_token = secrets[2];
  candidate.history.private_chats = secrets;
  candidate.controls.session_closed = true;
  const observed = evaluate(candidate, NOW);
  assert.equal(observed.action, 'detener');
  assert.equal(observed.continuation, null);
  assert.deepEqual(Object.keys(observed), [
    'action', 'idle_reason', 'idle_since', 'next_allowed_s',
    'last_prompt_s', 'last_reply_s', 'last_reply_chars',
    'msgs_hour', 'state', 'continuation'
  ]);
  const encoded = JSON.stringify(observed);
  for (const secret of secrets) assert.equal(encoded.includes(secret), false);
  const invalidSignal = { signalCode: 'ready', alertText: null,
    conversation_id: secrets[3] };
  const classified = classifyProviderPageSignal(invalidSignal, () => NOW);
  assert.equal(classified.state, 'unknown');
  assert.equal(JSON.stringify(classified).includes(secrets[3]), false);
  const limited = classifyProviderPageSignal({
    signalCode: 'rate-limit',
    alertText: 'Try again at 4:30 PM. ' + secrets[1] + ' ' + secrets[2]
  }, () => new Date(2030, 0, 1, 15, 0).getTime());
  assert.equal(limited.state, 'limit');
  for (const secret of secrets) {
    assert.equal(JSON.stringify(limited).includes(secret), false);
  }
}
const mode = process.argv[1];
if (mode === 'denial') denial();
else if (mode === 'diagnostics') diagnostics();
else throw new Error('Unexpected acceptance criterion');
"""


class OfflineSessionStateDenialTests(unittest.TestCase):
    def run_contract(self, criterion: str) -> None:
        completed = subprocess.run(
            ["node", "-e", NODE_HARNESS, criterion],
            cwd=ROOT, text=True, capture_output=True,
            timeout=30, check=False
        )
        self.assertEqual(
            completed.returncode, 0,
            f"{criterion} failed: {completed.stderr[-1800:]} "
            f"{completed.stdout[-300:]}"
        )

    def test_closed_session_unknown_and_rate_limit_fail_closed(self) -> None:
        self.run_contract("denial")

    def test_minimized_diagnostics_never_export_chat_identifiers(self) -> None:
        self.run_contract("diagnostics")


if __name__ == "__main__":
    unittest.main()
