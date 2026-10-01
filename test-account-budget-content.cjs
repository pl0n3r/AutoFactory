'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./content.js', 'utf8');

const budgetHelperStart = source.indexOf('async function waitForBudgetBeforeSend(prompt)');
const sendButtonStart = source.indexOf('function waitForSendButton', budgetHelperStart);
assert.ok(budgetHelperStart >= 0 && sendButtonStart > budgetHelperStart,
  'budget wait helper must exist before send-control polling');
const budgetHelper = source.slice(budgetHelperStart, sendButtonStart);
assert.ok(budgetHelper.includes('await budgetGuard.waitUntilReady()'),
  'budget helper must await shared account capacity explicitly');
assert.ok(budgetHelper.includes("if (currentText && !core.isOwnedDraft(field, prompt))"),
  'user text typed during a long budget wait must be preserved');
assert.equal(budgetHelper.includes('replaceComposerText'), false,
  'normal budget pacing must never create or clear a composer draft');

const sendStart = source.indexOf('async function sendPrompt(prompt)');
const tickStart = source.indexOf('async function tick()', sendStart);
assert.ok(sendStart >= 0 && tickStart > sendStart, 'sendPrompt/tick boundaries must exist');
const send = source.slice(sendStart, tickStart);
assert.equal(send.includes('waitUntilReady'), false,
  'sendPrompt must remain provider-send focused and independent of pacing waits');
assert.ok(send.includes('core.replaceComposerText(field, prompt, document)'),
  'composer mutation remains inside the actual send operation');

const tickEnd = source.indexOf('function setEnabled', tickStart);
assert.ok(tickEnd > tickStart, 'tick boundary must exist');
const tick = source.slice(tickStart, tickEnd);
const waitCall = tick.indexOf('await waitForBudgetBeforeSend(prompt)');
const sendCall = tick.indexOf('await sendPrompt(prompt)');
assert.ok(waitCall >= 0 && sendCall > waitCall,
  'tick must complete pacing before entering the provider send operation');

const waitStart = source.indexOf('function waitForSendButton(timeoutMs = 10000)');
const clearStart = source.indexOf('function waitForComposerClear', waitStart);
assert.ok(waitStart >= 0 && clearStart > waitStart);
const waitForSend = source.slice(waitStart, clearStart);
assert.ok(waitForSend.includes('budgetGuard?.nextAllowedAt?.()'),
  'send-button deadline must follow a budget race caused by another tab');
assert.ok(waitForSend.includes('Math.max(localDeadline, budgetDeadline)'),
  'budget pacing must extend, not replace, the normal provider-control timeout');

console.log('account-budget-content: pacing stays outside sendPrompt and preserves drafts');
