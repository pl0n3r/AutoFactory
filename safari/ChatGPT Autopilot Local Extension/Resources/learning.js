(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotLearning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const EMPTY = Object.freeze({
    cycles: 0, recoveries: 0, failures: 0,
    startupSamplesMs: [], responseSamplesMs: [], errorsByCode: {}, actionSuccess: {}
  });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const samples = (values, maximum = 21600000) => (Array.isArray(values) ? values : [])
    .filter(value => Number.isFinite(value) && value > 0 && value <= maximum).slice(-50);
  function normalize(memory = {}) {
    return {
      cycles: Number(memory.cycles) || 0,
      recoveries: Number(memory.recoveries) || 0,
      failures: Number(memory.failures) || 0,
      startupSamplesMs: samples(memory.startupSamplesMs, 600000),
      responseSamplesMs: samples(memory.responseSamplesMs)
      ,errorsByCode: { ...(memory.errorsByCode || {}) }
      ,actionSuccess: { ...(memory.actionSuccess || {}) }
    };
  }
  function percentile(values, ratio) {
    const ordered = samples(values).sort((a, b) => a - b);
    if (!ordered.length) return 0;
    return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
  }
  function update(memory, event, durationMs = 0, detail = {}) {
    const next = normalize(memory);
    if (event === 'cycle') {
      next.cycles += 1;
      if (durationMs > 0) next.responseSamplesMs.push(durationMs);
    } else if (event === 'startup' && durationMs > 0) {
      next.startupSamplesMs.push(durationMs);
    } else if (event === 'recovery') next.recoveries += 1;
    else if (event === 'failure') next.failures += 1;
    if (event === 'error' && detail.code) {
      next.errorsByCode[detail.code] = (next.errorsByCode[detail.code] || 0) + 1;
    }
    if (event === 'action-success' && detail.code && detail.action) {
      const key = `${detail.code}:${detail.action}`;
      next.actionSuccess[key] = (next.actionSuccess[key] || 0) + 1;
    }
      next.startupSamplesMs = samples(next.startupSamplesMs, 600000);
    next.responseSamplesMs = samples(next.responseSamplesMs);
    return next;
  }
  function startupTimeoutMs(memory) {
    const values = normalize(memory).startupSamplesMs;
    if (values.length < 3) return 45000;
    return clamp(percentile(values, 0.9) * 4, 15000, 90000);
  }
  function errorBackoffMs(memory, code) {
    const count = normalize(memory).errorsByCode[code] || 0;
    return clamp(15000 * Math.pow(2, Math.min(count, 4)), 15000, 300000);
  }
  return { EMPTY, normalize, update, startupTimeoutMs, errorBackoffMs };
});
