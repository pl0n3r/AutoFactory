'use strict';
const assert = require('node:assert/strict');
const { evaluate, createPolicy, MIN_PACING_S, MAX_RETRIES } = require('./factory-control-session-keepalive.js');
const BASE = 10_000;
function sample() {
  return {
    chat: { reservation_active: true, reply_complete: true,
      last_prompt_s: BASE - 900, last_reply_s: BASE - 800,
      last_activity_s: BASE - 700, last_reply_chars: 37, msgs_hour: 4,
      state: 'inactivo', identical_read_count: 2 },
    account: { observed_limit_hour: 40, msgs_hour: 15, usage_limited: false },
    controls: { enabled: true, manual_pause: false, kill_switch_running: true,
      circuit_breaker_open: false, ambiguous_send: false, session_closed: false },
    history: { retries_s: [] }
  };
}
function ac01() {
  assert.equal(MIN_PACING_S, 60);
  assert.equal(MAX_RETRIES, 3);
  const snap = sample();
  const policy = createPolicy({ now: () => BASE });
  const a = policy.decide(snap);
  assert.equal(a.action, 'reenganchar');
  assert.equal(a.idle_reason, 'activo');
  assert.equal(a.msgs_hour, 4);
  assert.ok(a.continuation.includes('issue reservado'));
  assert.equal(a.last_reply_chars, 37);
  assert.equal(a.idle_since, BASE - 700);
  assert.equal(Object.isFrozen(a), true);

  snap.chat.last_prompt_s = BASE - 20;
  snap.chat.last_activity_s = BASE - 20;
  assert.deepEqual([policy.decide(snap).action, policy.decide(snap).idle_reason],
    ['esperar', 'esperando_pacing']);
  snap.chat.last_prompt_s = BASE - 900;
  snap.chat.last_activity_s = BASE - 700;
  snap.chat.identical_read_count = 1;
  assert.equal(policy.decide(snap).action, 'detener');
  snap.chat.identical_read_count = 2;
  snap.history.retries_s = [BASE - 60];
  assert.deepEqual([policy.decide(snap).action, policy.decide(snap).next_allowed_s],
    ['esperar', BASE + 60]);
  snap.history.retries_s = [BASE - 700, BASE - 400, BASE - 180];
  assert.equal(policy.decide(snap).action, 'esperar');
  assert.equal(policy.decide(snap).next_allowed_s, BASE - 700 + 3600);
  snap.history.retries_s = [BASE - 3700];
  assert.equal(policy.decide(snap).action, 'reenganchar');
  assert.equal(createPolicy({now: () => BASE - 1}).decide(sample()).action, 'reenganchar');
  assert.throws(() => createPolicy({}), /Injected clock/);
}
function ac02() {
  const cases = [
    [s => { s.controls.enabled = false; }, 'pausa_manual'],
    [s => { s.controls.manual_pause = true; }, 'pausa_manual'],
    [s => { s.controls.kill_switch_running = false; }, 'pausa_manual'],
    [s => { s.controls.session_closed = true; }, 'sesion_cerrada'],
    [s => { s.account.usage_limited = true; }, 'limite_horario'],
    [s => { s.controls.circuit_breaker_open = true; }, 'circuit_breaker'],
    [s => { s.controls.ambiguous_send = true; }, 'envio_ambiguo_5min'],
    [s => { s.chat.reservation_active = false; }, 'sin_trabajo'],
    [s => { s.account.msgs_hour = 32; }, 'limite_horario'],
    [s => { s.account.observed_limit_hour = 0; }, 'desconocido'],
    [s => { s.account.observed_limit_hour = null; }, 'desconocido'],
    [s => { s.chat.last_reply_s = BASE + 1; }, 'desconocido'],
    [s => { s.history.retries_s = [BASE - 10, BASE - 10]; }, 'desconocido'],
    [s => { s.chat.identical_read_count = null; }, 'desconocido'],
  ];
  for (const [change, reason] of cases) {
    const snap = sample(); change(snap);
    const answer = evaluate(snap, BASE);
    assert.equal(answer.action, 'detener', reason);
    assert.equal(answer.idle_reason, reason);
    assert.equal(answer.continuation, null);
  }
  const snap = sample();
  snap.chat.private_message = 'PRIVATE USER MESSAGE';
  snap.account.email = 'private@example.invalid';
  snap.controls.access_token = 'not-for-output';
  const rendered = JSON.stringify(evaluate(snap, BASE));
  for (const forbidden of ['PRIVATE USER MESSAGE', 'private@example.invalid', 'not-for-output']) {
    assert.equal(rendered.includes(forbidden), false);
  }
  assert.deepEqual(Object.keys(evaluate(snap, BASE)), [
    'action', 'idle_reason', 'idle_since', 'next_allowed_s', 'last_prompt_s',
    'last_reply_s', 'last_reply_chars', 'msgs_hour', 'state', 'continuation']);
}
if (!process.argv[2] || process.argv[2] === 'AC-01') ac01();
if (!process.argv[2] || process.argv[2] === 'AC-02') ac02();
if (process.argv[2] && !['AC-01','AC-02'].includes(process.argv[2])) process.exitCode = 2;
