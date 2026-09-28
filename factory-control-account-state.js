(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryAccountState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATES = Object.freeze(['ready', 'limit', 'requires_login', 'error', 'unknown']);
  const MAX_RESET_FUTURE_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_ALERT_TEXT = 500;
  const PAGE_SIGNAL_CODES = Object.freeze([
    'ready', 'authentication', 'rate-limit', 'connection'
  ]);
  const PAGE_SIGNAL_STATE_INPUTS = Object.freeze({
    ready: Object.freeze({
      authenticated: true, usageLimited: false, providerError: false, resetAt: null
    }),
    authentication: Object.freeze({
      authenticated: false, usageLimited: false, providerError: false, resetAt: null
    }),
    connection: Object.freeze({
      authenticated: true, usageLimited: false, providerError: true, resetAt: null
    })
  });

  function unknown() {
    return Object.freeze({ state: 'unknown', resetAt: null });
  }

  function exactObject(value, fields) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every(field => Object.hasOwn(value, field));
  }

  function checkedNow(now) {
    if (typeof now !== 'function') throw new TypeError('Invalid account state clock');
    let nowMs;
    try { nowMs = now(); } catch (_error) { return null; }
    return Number.isSafeInteger(nowMs) && nowMs >= 0 ? nowMs : null;
  }

  function classifyAccountState(input, now = Date.now) {
    if (!exactObject(input, ['authenticated', 'usageLimited', 'providerError', 'resetAt'])) {
      return unknown();
    }
    if (typeof input.authenticated !== 'boolean' ||
        typeof input.usageLimited !== 'boolean' ||
        typeof input.providerError !== 'boolean') {
      throw new TypeError('Invalid account state signal');
    }

    const nowMs = checkedNow(now);
    if (nowMs === null) return unknown();

    if (input.providerError) {
      if (input.usageLimited || input.authenticated === false || input.resetAt !== null) {
        return unknown();
      }
      return Object.freeze({ state: 'error', resetAt: null });
    }

    if (!input.authenticated) {
      if (input.usageLimited || input.resetAt !== null) return unknown();
      return Object.freeze({ state: 'requires_login', resetAt: null });
    }

    if (input.usageLimited) {
      if (input.resetAt === null) {
        return Object.freeze({ state: 'limit', resetAt: null });
      }
      if (!Number.isSafeInteger(input.resetAt) ||
          input.resetAt <= nowMs ||
          input.resetAt > nowMs + MAX_RESET_FUTURE_MS) {
        return unknown();
      }
      return Object.freeze({ state: 'limit', resetAt: input.resetAt });
    }

    if (input.resetAt !== null) return unknown();
    return Object.freeze({ state: 'ready', resetAt: null });
  }

  function normalizedMeridiem(value) {
    return value.toLowerCase().replace(/[.\s]/g, '');
  }

  function addClockCandidate(candidates, hour, minute, index, length) {
    candidates.push({ hour, minute, index, length });
  }

  function clockCandidates(text) {
    const candidates = [];
    const meridiemPattern = /(\d{1,2})(?::([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)(?![a-z])/gi;
    let match;
    while ((match = meridiemPattern.exec(text)) !== null) {
      const rawHour = Number(match[1]);
      const minute = match[2] === undefined ? 0 : Number(match[2]);
      const meridiem = normalizedMeridiem(match[3]);
      if (rawHour < 1 || rawHour > 12) continue;
      let hour = rawHour % 12;
      if (meridiem === 'pm') hour += 12;
      addClockCandidate(candidates, hour, minute, match.index, match[0].length);
    }

    const twentyFourHourPattern = /(^|[^\d])(\d{1,2}):([0-5]\d)(?!\d)/g;
    while ((match = twentyFourHourPattern.exec(text)) !== null) {
      const hour = Number(match[2]);
      const minute = Number(match[3]);
      const tokenIndex = match.index + match[1].length;
      const overlapsMeridiem = candidates.some(candidate =>
        tokenIndex >= candidate.index &&
        tokenIndex < candidate.index + candidate.length
      );
      if (!overlapsMeridiem && hour >= 0 && hour <= 23) {
        addClockCandidate(
          candidates,
          hour,
          minute,
          tokenIndex,
          match[0].length - match[1].length
        );
      }
    }

    const unique = new Map();
    for (const candidate of candidates) {
      unique.set(candidate.hour + ':' + candidate.minute, candidate);
    }
    return [...unique.values()];
  }

  function sameLocalMinute(left, right) {
    return left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate() &&
      left.getHours() === right.getHours() &&
      left.getMinutes() === right.getMinutes();
  }

  function repeatedHourOccurrence(target, nowMs) {
    const probe = new Date(target.getTime() + 3 * 60 * 60 * 1000);
    const offsetDeltaMinutes = probe.getTimezoneOffset() - target.getTimezoneOffset();
    if (offsetDeltaMinutes <= 0) return null;

    const later = new Date(target.getTime() + offsetDeltaMinutes * 60 * 1000);
    return later.getTime() > nowMs && sameLocalMinute(later, target)
      ? later.getTime()
      : null;
  }

  function nextLocalOccurrence(nowMs, hour, minute) {
    const target = new Date(nowMs);
    if (Number.isNaN(target.getTime())) return null;

    target.setHours(hour, minute, 0, 0);
    let value = target.getTime();
    const normalized = target.getHours() !== hour || target.getMinutes() !== minute;
    if (normalized) {
      target.setDate(target.getDate() + 1);
      target.setHours(hour, minute, 0, 0);
      value = target.getTime();
    } else if (value <= nowMs) {
      value = repeatedHourOccurrence(target, nowMs);
      if (value === null) {
        target.setDate(target.getDate() + 1);
        target.setHours(hour, minute, 0, 0);
        value = target.getTime();
      }
    }

    if (!Number.isSafeInteger(value) ||
        value <= nowMs ||
        value > nowMs + MAX_RESET_FUTURE_MS) {
      return null;
    }
    return value;
  }

  function resetAtFromAlert(alertText, nowMs) {
    if (alertText === null) return null;
    if (typeof alertText !== 'string' ||
        alertText.length < 1 ||
        alertText.length > MAX_ALERT_TEXT) {
      return undefined;
    }
    const candidates = clockCandidates(alertText);
    if (candidates.length !== 1) return null;
    return nextLocalOccurrence(nowMs, candidates[0].hour, candidates[0].minute);
  }

  function classifyProviderPageSignal(input, now = Date.now) {
    if (!exactObject(input, ['signalCode', 'alertText']) ||
        typeof input.signalCode !== 'string' ||
        !PAGE_SIGNAL_CODES.includes(input.signalCode)) {
      return unknown();
    }

    const nowMs = checkedNow(now);
    if (nowMs === null) return unknown();

    if (input.signalCode !== 'rate-limit' && input.alertText !== null) {
      return unknown();
    }

    const stateInput = PAGE_SIGNAL_STATE_INPUTS[input.signalCode];
    if (stateInput) return classifyAccountState(stateInput, () => nowMs);

    const resetAt = resetAtFromAlert(input.alertText, nowMs);
    if (resetAt === undefined) return unknown();
    return classifyAccountState(
      { authenticated: true, usageLimited: true, providerError: false, resetAt },
      () => nowMs
    );
  }

  return Object.freeze({
    STATES,
    PAGE_SIGNAL_CODES,
    classifyAccountState,
    classifyProviderPageSignal
  });
});
