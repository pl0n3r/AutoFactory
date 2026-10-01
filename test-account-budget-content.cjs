'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./content.js', 'utf8');
const sendStart = source.indexOf('async function sendPrompt(prompt)');
const tickStart = source.indexOf('async function tick()', sendStart);
assert.ok(sendStart >= 0 && tickStart > sendStart, 'sendPrompt/tick boundaries must exist');
const send = source.slice(sendStart, tickStart);

const budgetWait = send.indexOf('await budgetGuard.waitUntilReady()');
const disabledExit = send.indexOf('if (!budgetReady || !state.enabled) return false;');
const composerLookup = send.indexOf('const field = core.composer(document);');
const composerMutation = send.indexOf('core.replaceComposerText(field, prompt, document)');
assert.ok(budgetWait >= 0, 'sendPrompt must await the shared budget explicitly');
assert.ok(disabledExit > budgetWait && composerLookup > disabledExit,
  'disabled/budget-wait exit must happen before reading or mutating the composer');
assert.ok(composerMutation > composerLookup,
  'composer mutation must happen only after budget readiness and a fresh field lookup');
assert.equal(send.slice(0, budgetWait).includes('replaceComposerText'), false,
  'normal budget pacing must not create or clear a draft before capacity is ready');
assert.ok(send.includes("if (currentText && !core.isOwnedDraft(field, prompt))"),
  'user text typed during a long budget wait must be preserved');

const waitStart = source.indexOf('function waitForSendButton(timeoutMs = 10000)');
const clearStart = source.indexOf('function waitForComposerClear', waitStart);
assert.ok(waitStart >= 0 && clearStart > waitStart);
const waitForSend = source.slice(waitStart, clearStart);
assert.ok(waitForSend.includes('budgetGuard?.nextAllowedAt?.()'),
  'send-button deadline must follow a budget race caused by another tab');
assert.ok(waitForSend.includes('Math.max(localDeadline, budgetDeadline)'),
  'budget pacing must extend, not replace, the normal provider-control timeout');

console.log('account-budget-content: pacing precedes drafts and extends race deadline');
