(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotSharedLearningProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SCHEMA_VERSION = 1;
  const MAX_BATCH_BYTES = 16 * 1024;
  const ACTIONS = new Set(['wait', 'retry', 'reload', 'stop_wait', 'open_replacement_chat']);
  const OUTCOMES = new Set(['success', 'failure', 'abandoned']);
  const BROWSERS = new Set(['chrome', 'safari', 'edge', 'other']);
  const PRIVATE_FIELDS = new Set(['prompt', 'response', 'url', 'conversationId', 'repository', 'email', 'token', 'dom', 'pageText']);
  const EVENT_FIELDS = [
    'eventId','installationId','browserFamily','extensionVersion','problemCode',
    'interfaceState','action','durationMs','attempt','outcome','policyVersion','observedAt'
  ];
  const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const BUILT_IN_POLICY = Object.freeze({
    schemaVersion: SCHEMA_VERSION, policyVersion: 0, issuedAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER, enabled: false, rollbackVersion: 0,
    contexts: Object.freeze({})
  });
  function integer(value, name, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(name + ' is invalid');
    return value;
  }
  function token(value, name) {
    if (typeof value !== 'string' || !TOKEN.test(value)) throw new TypeError(name + ' is invalid');
    return value;
  }
  function sanitizeOutcome(input, now = Date.now()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('event is invalid');
    for (const key of Object.keys(input)) {
      if (!EVENT_FIELDS.includes(key) && !PRIVATE_FIELDS.has(key)) throw new TypeError('unexpected event field');
    }
    integer(now, 'now');
    const action = token(input.action, 'action');
    if (!ACTIONS.has(action)) throw new TypeError('action is invalid');
    if (!OUTCOMES.has(input.outcome)) throw new TypeError('outcome is invalid');
    if (!BROWSERS.has(input.browserFamily)) throw new TypeError('browserFamily is invalid');
    const observedAt = integer(input.observedAt, 'observedAt');
    if (observedAt > now + 300_000 || observedAt < now - 30 * 86_400_000) throw new TypeError('observedAt is invalid');
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      eventId: token(input.eventId, 'eventId'),
      installationId: token(input.installationId, 'installationId'),
      browserFamily: input.browserFamily,
      extensionVersion: token(input.extensionVersion, 'extensionVersion'),
      problemCode: token(input.problemCode, 'problemCode'),
      interfaceState: token(input.interfaceState, 'interfaceState'),
      action,
      durationMs: integer(input.durationMs, 'durationMs'),
      attempt: integer(input.attempt, 'attempt'),
      outcome: input.outcome,
      policyVersion: integer(input.policyVersion, 'policyVersion'),
      observedAt
    });
  }
  function sanitizeBatch(input, now = Date.now()) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 100) throw new TypeError('batch is invalid');
    const batch = input.map(event => sanitizeOutcome(event, now));
    if (new TextEncoder().encode(JSON.stringify(batch)).byteLength > MAX_BATCH_BYTES) throw new TypeError('batch is too large');
    return Object.freeze(batch);
  }
  function validatePolicySnapshot(input, now = Date.now(), currentVersion = 0) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('policy is invalid');
    const fields = ['schemaVersion','policyVersion','issuedAt','expiresAt','enabled','rollbackVersion','contexts'];
    if (Object.keys(input).length !== fields.length || !fields.every(key => Object.hasOwn(input, key))) throw new TypeError('policy fields are invalid');
    integer(now, 'now');
    if (input.schemaVersion !== SCHEMA_VERSION) throw new TypeError('schema version is invalid');
    const policyVersion = integer(input.policyVersion, 'policyVersion');
    if (policyVersion < currentVersion) throw new TypeError('policy version is stale');
    const issuedAt = integer(input.issuedAt, 'issuedAt');
    const expiresAt = integer(input.expiresAt, 'expiresAt');
    if (issuedAt > now + 300_000 || expiresAt <= now || expiresAt <= issuedAt) throw new TypeError('policy expired or invalid');
    if (typeof input.enabled !== 'boolean') throw new TypeError('enabled is invalid');
    const rollbackVersion = integer(input.rollbackVersion, 'rollbackVersion');
    if (!input.contexts || typeof input.contexts !== 'object' || Array.isArray(input.contexts)) throw new TypeError('contexts are invalid');
    const contexts = {};
    for (const [key, value] of Object.entries(input.contexts)) {
      token(key, 'context');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('context is invalid');
      const action = token(value.action, 'action');
      if (!ACTIONS.has(action)) throw new TypeError('action is invalid');
      if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
          !Number.isFinite(value.successRate) || value.successRate < 0 || value.successRate > 1) throw new TypeError('confidence is invalid');
      contexts[key] = Object.freeze({action, confidence:value.confidence, successRate:value.successRate, samples:integer(value.samples, 'samples')});
    }
    return Object.freeze({schemaVersion:SCHEMA_VERSION,policyVersion,issuedAt,expiresAt,enabled:input.enabled,rollbackVersion,contexts:Object.freeze(contexts)});
  }
  return {SCHEMA_VERSION,MAX_BATCH_BYTES,ACTIONS,BUILT_IN_POLICY,sanitizeOutcome,sanitizeBatch,validatePolicySnapshot};
});
