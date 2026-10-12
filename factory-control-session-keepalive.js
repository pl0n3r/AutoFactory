/* Factory #163: pure, offline continuation policy. No network, timers or clicks. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotSessionKeepalive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MIN_PACING_S = 60;
  const IDLE_AFTER_S = 600;
  const WINDOW_S = 3600;
  const MAX_RETRIES = 3;
  const CONTINUATION = 'Continúa: relee el estado del issue reservado, ejecuta el siguiente paso y fusiona por squash solo si todos los controles obligatorios están verdes; si no tienes reserva, busca el siguiente issue disponible. Si está bloqueado, registra la causa concreta y sigue con otro frente seguro.';

  const plain = value => value !== null && typeof value === 'object' &&
    !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);
  const second = value => Number.isSafeInteger(value) && value >= 0;
  const optionalSecond = value => value === null || second(value);
  const count = value => Number.isSafeInteger(value) && value >= 0;

  function evaluate(input, now_s) {
    const chat = plain(input) && plain(input.chat) ? input.chat : null;
    const account = plain(input) && plain(input.account) ? input.account : null;
    const controls = plain(input) && plain(input.controls) ? input.controls : null;
    const history = plain(input) && plain(input.history) ? input.history : null;
    const idle_since = chat && second(chat.last_activity_s) ? chat.last_activity_s : null;
    // Only explicitly allowed metrics leave this module; no account IDs,
    // chat content, URLs, tokens, sender identity or conversation fingerprints.
    const metrics = chat ? {
      last_prompt_s: optionalSecond(chat.last_prompt_s) ? chat.last_prompt_s : null,
      last_reply_s: optionalSecond(chat.last_reply_s) ? chat.last_reply_s : null,
      last_reply_chars: count(chat.last_reply_chars) ? chat.last_reply_chars : null,
      msgs_hour: count(chat.msgs_hour) ? chat.msgs_hour : null,
      state: ['activo', 'inactivo', 'cerrado'].includes(chat.state) ? chat.state : 'desconocido'
    } : { last_prompt_s: null, last_reply_s: null, last_reply_chars: null,
           msgs_hour: null, state: 'desconocido' };
    const result = (action, idle_reason, next_allowed_s = null) => Object.freeze({
      action, idle_reason, idle_since, next_allowed_s,
      ...metrics,
      continuation: action === 'reenganchar' ? CONTINUATION : null
    });
    const unknown = () => result('detener', 'desconocido');

    if (!second(now_s) || !chat || !account || !controls || !history ||
        !optionalSecond(chat.last_prompt_s) || !optionalSecond(chat.last_reply_s) ||
        !second(chat.last_activity_s) || !count(chat.last_reply_chars) ||
        !count(chat.msgs_hour) || !['activo', 'inactivo', 'cerrado'].includes(chat.state) ||
        typeof chat.reservation_active !== 'boolean' ||
        typeof chat.reply_complete !== 'boolean' ||
        !count(chat.identical_read_count) ||
        !count(account.msgs_hour) || !count(account.observed_limit_hour) ||
        account.observed_limit_hour === 0 ||
        typeof account.usage_limited !== 'boolean' ||
        !['enabled', 'manual_pause', 'kill_switch_running', 'circuit_breaker_open',
          'ambiguous_send', 'session_closed'].every(k => typeof controls[k] === 'boolean') ||
        !Array.isArray(history.retries_s) || history.retries_s.length > 100 ||
        !history.retries_s.every(second)) return unknown();

    const times = [chat.last_prompt_s, chat.last_reply_s, chat.last_activity_s]
      .filter(value => value !== null);
    if (times.some(value => value > now_s) ||
        chat.last_activity_s < Math.max(...times) ||
        history.retries_s.some(value => value > now_s)) return unknown();
    // A 'complete' reply must belong to the latest prompt. An earlier
    // reply can be from a prior turn and cannot authorize another send.
    // While the new reply is still pending, the normal wait path applies.
    if (chat.reply_complete &&
        (chat.last_prompt_s === null || chat.last_reply_s === null ||
         chat.last_reply_s < chat.last_prompt_s)) return unknown();
    for (let i = 1; i < history.retries_s.length; i++) {
      if (history.retries_s[i] <= history.retries_s[i - 1]) return unknown();
    }
    // Feature flag and all platform/owner gates fail closed before any suggestion.
    if (!controls.enabled || controls.manual_pause || !controls.kill_switch_running) {
      return result('detener', 'pausa_manual');
    }
    if (controls.session_closed || chat.state === 'cerrado') return result('detener', 'sesion_cerrada');
    if (account.usage_limited) return result('detener', 'limite_horario');
    if (controls.circuit_breaker_open) return result('detener', 'circuit_breaker');
    if (controls.ambiguous_send) return result('detener', 'envio_ambiguo_5min');
    if (!chat.reservation_active) return result('detener', 'sin_trabajo');

    // Optional explicit per-chat pacing; never accept <60s or unbounded values.
    const minPacing = Object.hasOwn(controls, 'min_pacing_s')
      ? controls.min_pacing_s : MIN_PACING_S;
    if (!second(minPacing) || minPacing < MIN_PACING_S || minPacing > WINDOW_S) return unknown();
    const safeHourBudget = Math.floor(account.observed_limit_hour * 0.8);
    if (safeHourBudget < 1 || account.msgs_hour >= safeHourBudget) {
      return result('detener', 'limite_horario');
    }
    const lastPrompt = chat.last_prompt_s;
    if (lastPrompt !== null && now_s - lastPrompt < minPacing) {
      const next = lastPrompt + minPacing;
      return second(next) ? result('esperar', 'esperando_pacing', next) : unknown();
    }
    if (!chat.reply_complete || chat.last_reply_s === null) return result('esperar', 'activo');
    const idleUntil = chat.last_activity_s + IDLE_AFTER_S;
    if (now_s <= idleUntil) return result('esperar', 'activo', idleUntil + 1);
    // A single stale/ambiguous UI observation cannot authorize another send.
    if (chat.identical_read_count < 2) return unknown();
    const recent = history.retries_s.filter(t => t > now_s - WINDOW_S);
    if (recent.length >= MAX_RETRIES) {
      return result('esperar', 'esperando_pacing', recent[0] + WINDOW_S);
    }
    if (recent.length) {
      const backoff = Math.min(900, 60 * (2 ** recent.length));
      const next = recent[recent.length - 1] + backoff;
      if (now_s < next) return result('esperar', 'esperando_pacing', next);
    }
    // A one-hour retry window bounds rate counting, NOT uncertainty.
    // Never discard an unacknowledged send solely because it aged out.
    if (history.retries_s.length &&
        history.retries_s[history.retries_s.length - 1] > chat.last_reply_s) {
      return unknown();
    }
    return result('reenganchar', 'activo');
  }

  function createPolicy({ now } = {}) {
    if (typeof now !== 'function') throw new TypeError('Injected clock is required');
    return Object.freeze({ decide: snapshot => {
      let current;
      try { current = now(); } catch (_error) { current = null; }
      return evaluate(snapshot, current);
    } });
  }

  return Object.freeze({ evaluate, createPolicy, MIN_PACING_S, IDLE_AFTER_S, MAX_RETRIES });
});
