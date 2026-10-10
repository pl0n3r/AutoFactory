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
assert.ok(budgetHelper.includes("if (currentText && !promptMatches(currentText, prompt))"),
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

const core = require('./autopilot-core.js');
assert.equal(core.budgetWaitLabel(20000, 1000), 'Presupuesto compartido: esperando 19 s');
assert.equal(core.budgetWaitLabel(null, 1000), 'Verificando presupuesto compartido');
console.log('account-budget-content: live pacing status is deterministic');

assert.ok(budgetHelper.includes("budgetReady?.reason === 'budget_unavailable'"),
  'typed budget expiry must have a dedicated blocked branch');
assert.ok(budgetHelper.includes('state.enabled = false'),
  'an unknown budget must pause the local tab rather than requeue a send');
assert.ok(budgetHelper.includes("log('budget-blocked', { code: 'budget_unavailable' })"),
  'blocked diagnostic must be typed and contain no composer contents');
assert.ok(budgetHelper.includes('budgetReady !== true'),
  'truthy typed budget results must never grant send permission');
assert.ok(tick.includes('state.busy = false;'),
  'tick must release busy even on budget expiry');
{
  const status = [], events = [];
  const state = { enabled: true, busy: true, nextSendAt: 1000 };
  const field = { draft: 'unsent draft' };
  const guard = {
    nextAllowedAt: () => null,
    waitUntilReady: async () => ({ ok: false, reason: 'budget_unavailable' })
  };
  const coreFake = {
    budgetWaitLabel: () => 'Verificando presupuesto compartido',
    composer: () => field,
    composerText: current => current?.draft || ''
  };
  const makeHelper = new Function(
    'budgetGuard', 'core', 'setStatus', 'setInterval', 'clearInterval',
    'state', 'log', 'promptMatches', 'document',
    'return (' + budgetHelper.trim() + ');'
  );
  const helper = makeHelper(
    guard, coreFake, (value, kind) => { status.push({ value, kind }); },
    () => 1, () => {}, state,
    (code, detail) => { events.push({ code, detail }); },
    (value, prompt) => value === prompt, {}
  );
  helper('unsent draft').then(result => {
    assert.equal(result, false, 'unavailable budget must prevent provider send');
    assert.equal(state.enabled, false, 'tab must pause until deliberate re-enable');
    assert.equal(field.draft, 'unsent draft', 'draft must be preserved');
    assert.ok(status.some(entry => entry.kind === 'error' && entry.value.includes('presupuesto')));
    assert.deepEqual(events, [{
      code: 'budget-blocked', detail: { code: 'budget_unavailable' }
    }], 'diagnostic must contain no chat text or secrets');
    console.log('account-budget-content: typed blocked result pauses safely');
  }).catch(error => { console.error(error); process.exitCode = 1; });
}

