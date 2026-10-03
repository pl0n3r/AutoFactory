 (function (root, factory) {
   const api = factory();
   if (typeof module === 'object' && module.exports) module.exports = api;
   else root.ChatGPTAutopilotFactoryProtocol = api;
 })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
   'use strict';
 
   const VERSION = 1;
   const TAB_STATES = new Set([
     'paused', 'waiting', 'generating', 'sending', 'error', 'limit', 'requires_login'
   ]);
   const ACCOUNT_STATES = new Set([
     'ready', 'limit', 'requires_login', 'error', 'unknown'
   ]);
   const ACTIONS = new Set([
     'pause', 'resume', 'open_chat', 'set_prompt', 'set_mode', 'send_message'
   ]);
   const ERROR_CODES = new Set([
     'ok', 'invalid', 'not_found', 'not_ready', 'timeout', 'unauthorized',
     'already_handled', 'failed'
   ]);
   const BUDGET_FIELDS = [
     'windowMs', 'budget', 'sent', 'remaining', 'limitEvents',
     'highReasoningSends', 'nextAllowedAt', 'source'
   ];
   const MAX_BUDGET_EVENTS = 512;
 
   function object(value, label) {
     if (!value || typeof value !== 'object' || Array.isArray(value)) {
       throw new TypeError(label + ' must be an object');
     }
     return value;
   }
 
   function keys(value, allowed, label) {
     for (const key of Object.keys(value)) {
       if (!allowed.includes(key)) throw new TypeError(label + ' has an unsupported field');
     }
   }
 
   function identifier(value, label) {
     if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) {
       throw new TypeError(label + ' is invalid');
     }
     return value;
   }
 
   function alias(value, label) {
     if (typeof value !== 'string' || value.trim() !== value || !value ||
         value.length > 64 || /[@\r\n\x00-\x1f]/.test(value)) {
       throw new TypeError(label + ' must be a short alias, not an email or secret');
     }
     return value;
   }
 
   function tabId(value) {
     if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid tab ID');
     return value;
   }
 
   function normalizedAccountState(value) {
     if (value === undefined) return { state: 'unknown', resetAt: null };
     object(value, 'accountState');
     keys(value, ['state', 'resetAt'], 'accountState');
     if (!Object.hasOwn(value, 'state') || !Object.hasOwn(value, 'resetAt') ||
         !ACCOUNT_STATES.has(value.state)) {
       throw new TypeError('Invalid account state');
     }
     if (value.state === 'limit') {
       if (value.resetAt !== null &&
           (!Number.isSafeInteger(value.resetAt) || value.resetAt < 1)) {
         throw new TypeError('Invalid account state resetAt');
       }
     } else if (value.resetAt !== null) {
       throw new TypeError('Invalid account state resetAt');
     }
     return { state: value.state, resetAt: value.resetAt };
   }
 
   function normalizedMessageBudget(value) {
     object(value, 'messageBudget');
     keys(value, BUDGET_FIELDS, 'messageBudget');
     if (!BUDGET_FIELDS.every(key => Object.hasOwn(value, key))) {
       throw new TypeError('Invalid message budget');
     }
     const integers = ['windowMs', 'budget', 'sent', 'remaining', 'limitEvents', 'highReasoningSends'];
     if (!integers.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) ||
         value.windowMs < 60000 || value.windowMs > 86400000 ||
         value.budget < 1 || value.budget > MAX_BUDGET_EVENTS ||
         value.sent > value.budget ||
         value.remaining !== value.budget - value.sent ||
         value.limitEvents > MAX_BUDGET_EVENTS ||
         value.highReasoningSends > value.sent ||
         (value.nextAllowedAt !== null &&
           (!Number.isSafeInteger(value.nextAllowedAt) || value.nextAllowedAt < 1)) ||
         !['default', 'factory'].includes(value.source)) {
       throw new TypeError('Invalid message budget');
     }
     return {
       windowMs: value.windowMs,
       budget: value.budget,
       sent: value.sent,
       remaining: value.remaining,
       limitEvents: value.limitEvents,
       highReasoningSends: value.highReasoningSends,
       nextAllowedAt: value.nextAllowedAt,
       source: value.source
     };
   }
 
   function heartbeat(input) {
     object(input, 'heartbeat');
     keys(input, ['profileAlias', 'accountAlias', 'tabs', 'lastEvent', 'accountState', 'messageBudget'], 'heartbeat');
     if (!Array.isArray(input.tabs) || input.tabs.length > 40) {
       throw new TypeError('Too many tabs or missing tabs');
     }
     for (let index = 0; index < input.tabs.length; index++) {
       if (!Object.hasOwn(input.tabs, index)) throw new TypeError('Sparse tab metadata');
     }
     const seen = new Set();
     const tabs = input.tabs.map(tab => {
       object(tab, 'tab');
       keys(tab, ['tabId', 'enabled', 'state'], 'tab');
       const id = tabId(tab.tabId);
       if (seen.has(id)) throw new TypeError('Duplicate tab ID');
       seen.add(id);
       if (typeof tab.enabled !== 'boolean' || !TAB_STATES.has(tab.state)) {
         throw new TypeError('Invalid tab metadata');
       }
       return { tabId: id, enabled: tab.enabled, state: tab.state };
     });
     let lastEvent = null;
     if (input.lastEvent !== undefined && input.lastEvent !== null) {
       if (typeof input.lastEvent !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.lastEvent)) {
         throw new TypeError('Invalid diagnostic event code');
       }
       lastEvent = input.lastEvent;
     }
     const result = {
       version: VERSION, kind: 'heartbeat',
       profileAlias: alias(input.profileAlias, 'profileAlias'),
       accountAlias: alias(input.accountAlias, 'accountAlias'),
       tabs,
       accountState: normalizedAccountState(input.accountState),
       lastEvent
     };
     if (input.messageBudget !== undefined) {
       result.messageBudget = normalizedMessageBudget(input.messageBudget);
     }
     return result;
   }
 
   function command(input) {
     object(input, 'command');
     keys(input, ['id', 'action', 'target', 'payload'], 'command');
     const id = identifier(input.id, 'command ID');
     if (!ACTIONS.has(input.action)) throw new TypeError('Unsupported command action');
     const target = input.target === 'all' ? 'all' : tabId(input.target);
     const action = input.action;
     if (target === 'all' && action !== 'pause' && action !== 'resume') {
       throw new TypeError('Broadcast is restricted to pause and resume');
     }
     let payload = null;
     if (action === 'send_message' || action === 'set_prompt') {
       object(input.payload, 'payload');
       keys(input.payload, ['text'], 'payload');
       if (typeof input.payload.text !== 'string' || !input.payload.text.trim() ||
           input.payload.text.length > 16000) throw new TypeError('Invalid message length');
       payload = { text: input.payload.text };
     } else if (action === 'set_mode') {
       object(input.payload, 'payload');
       keys(input.payload, ['mode'], 'payload');
       if (!['chat', 'work'].includes(input.payload.mode)) {
         throw new TypeError('Unsupported conversation mode');
       }
       payload = { mode: input.payload.mode };
     } else if (input.payload !== undefined && input.payload !== null) {
       throw new TypeError('Unexpected command payload');
     }
     return { version: VERSION, kind: 'command', id, action, target, payload };
   }
 
   function acknowledgement(input) {
     object(input, 'acknowledgement');
     keys(input, ['id', 'ok', 'code'], 'acknowledgement');
     const id = identifier(input.id, 'command ID');
     if (typeof input.ok !== 'boolean' || !ERROR_CODES.has(input.code) ||
         input.ok !== (input.code === 'ok')) {
       throw new TypeError('Invalid acknowledgement result');
     }
     return { version: VERSION, kind: 'ack', id, ok: input.ok, code: input.code };
   }
 
   return Object.freeze({ VERSION, heartbeat, command, acknowledgement });
 });
 