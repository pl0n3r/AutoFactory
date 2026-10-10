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
// Behavior is exercised using the real content script in the JSDOM scenario below.
assert.ok(budgetHelper.includes("sessionStorage.setItem(BUDGET_BLOCK_KEY, '1')"),
  'a blocked tab must persist its non-sensitive latch');
assert.ok(send.includes('budgetGuard?.confirmSent?.()'),
  'only confirmed provider delivery acknowledges the capacity reservation');

const { JSDOM } = require('jsdom');
const reliability = require('./reliability.js');
const learning = require('./learning.js');

async function microtasks() {
  await new Promise(resolve => setImmediate(resolve));
}

function bootFakeTab(session, decision, { failBudgetBlockWrite = false } = {}) {
  const dom = new JSDOM(
    '<!doctype html><div id="prompt-textarea" contenteditable="true">Draft fixture</div>',
    { url: 'https://chatgpt.com/', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;
  for (const [key, value] of session) window.sessionStorage.setItem(key, value);
  if (failBudgetBlockWrite) {
    const prototype = Object.getPrototypeOf(window.sessionStorage);
    const originalSetItem = prototype.setItem;
    prototype.setItem = function (key, value) {
      if (key === 'chatgpt-autopilot-budget-blocked-v1') {
        throw new window.DOMException('Storage unavailable', 'SecurityError');
      }
      return originalSetItem.call(this, key, value);
    };
  }
  const runtimeListeners = [];
  let now = 100000;
  let budgetCalls = 0;
  let clicks = 0;
  const field = window.document.getElementById('prompt-textarea');
  field.addEventListener('click', () => { clicks += 1; });
  window.Date.now = () => now;
  window.setInterval = () => 1;
  window.clearInterval = () => {};
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  window.scrollBy = () => {};
  window.ChatGPTAutopilotCore = {
    ...require('./autopilot-core.js'),
    pageSignal: () => ({ code: 'ready', action: 'continue' }),
    stopButton: () => null,
    canSend: () => false,
    sendButton: () => null
  };
  window.ChatGPTAutopilotLearning = learning;
  window.ChatGPTAutopilotReliability = reliability;
  window.ChatGPTAutopilotAdaptiveRecovery = {};
  window.ChatGPTAutopilotBudgetGuard = {
    nextAllowedAt: () => null,
    waitUntilReady: async () => {
      budgetCalls += 1;
      return decision();
    }
  };
  window.chrome = {
    runtime: {
      sendMessage: () => Promise.resolve({ ok: true }),
      getManifest: () => ({ version: 'test' }),
      onMessage: { addListener(listener) { runtimeListeners.push(listener); } }
    },
    storage: {
      local: {
        get(defaults, callback) {
          callback({
            ...defaults, masterEnabled: true,
            prompt: 'Draft fixture', promptSchemaVersion: 2,
            conversationMode: 'chat', modelTarget: 'keep', reasoningLevel: 'keep',
            periodicReload: false, autoReload: false, followScroll: false
          });
        },
        set(_values, callback) { callback?.(); }
      },
      onChanged: { addListener() {} }
    }
  };
  window.eval(source);
  function emit(type, extra = {}) {
    for (const listener of runtimeListeners) listener({ type, ...extra }, {}, () => {});
  }
  return {
    emit, advance: () => { now += 6000; },
    budgetCalls: () => budgetCalls, clicks: () => clicks,
    draft: () => field.textContent,
    isEnabled: () => {
      let result;
      for (const listener of runtimeListeners) {
        listener({ type: 'autopilot:get-status' }, {}, response => { result = response; });
      }
      return Boolean(result?.enabled);
    },
    stored: () => new Map(Array.from({ length: window.sessionStorage.length },
      (_, i) => {
        const key = window.sessionStorage.key(i);
        return [key, window.sessionStorage.getItem(key)];
      })),
    close: () => dom.window.close()
  };
}

(async () => {
  const first = bootFakeTab(new Map(), () => ({
    ok: false, reason: 'budget_unavailable'
  }));
  first.advance();
  first.emit('autopilot:heartbeat');
  await microtasks();
  assert.equal(first.budgetCalls(), 1,
    'the real tick must wait for the budget once');
  assert.equal(first.isEnabled(), false,
    'typed unavailable must pause the real content runtime');
  assert.equal(first.draft(), 'Draft fixture', 'the composer draft must be preserved');
  const persisted = first.stored();
  assert.equal(persisted.get('chatgpt-autopilot-budget-blocked-v1'), '1',
    'a tab-local block must survive navigation');
  first.close();

  const storageFault = bootFakeTab(new Map(), () => ({
    ok: false, reason: 'budget_unavailable'
  }), { failBudgetBlockWrite: true });
  storageFault.advance();
  storageFault.emit('autopilot:heartbeat');
  await microtasks();
  assert.equal(storageFault.budgetCalls(), 1,
    'budget failure still reaches the real guard with sessionStorage disabled');
  assert.equal(storageFault.isEnabled(), false,
    'storage exception cannot prevent tab from pausing');
  assert.equal(storageFault.draft(), 'Draft fixture',
    'storage exception cannot delete an unsent draft');
  storageFault.emit('autopilot:heartbeat');
  await microtasks();
  assert.equal(storageFault.budgetCalls(), 1,
    'a paused tab never silently retries after storage failure');
  assert.equal(storageFault.clicks(), 0,
    'storage exception cannot authorize a provider click');
  storageFault.close();

  const reloaded = bootFakeTab(persisted, () => true);
  reloaded.advance();
  reloaded.emit('autopilot:heartbeat');
  await microtasks();
  assert.equal(reloaded.isEnabled(), false,
    'storage masterEnabled=true must not re-arm a blocked tab after reload');
  assert.equal(reloaded.budgetCalls(), 0,
    'late budget recovery must never automatically retry a blocked send');
  assert.equal(reloaded.clicks(), 0, 'no synthetic click while blocked');
  assert.equal(reloaded.draft(), 'Draft fixture', 'reload preserves user-visible draft');

  reloaded.emit('autopilot:set-enabled', { enabled: true });
  reloaded.advance();
  assert.equal(reloaded.isEnabled(), true, 'explicit local enable clears the block');
  assert.equal(reloaded.stored().has('chatgpt-autopilot-budget-blocked-v1'), false,
    'explicit enable removes only tab-local latch');
  reloaded.emit('autopilot:heartbeat');
  reloaded.emit('autopilot:heartbeat');
  await microtasks();
  assert.equal(reloaded.budgetCalls(), 1,
    'the real busy guard must prevent duplicate concurrent budget waits');
  assert.equal(reloaded.clicks(), 0,
    'a permitted budget alone never authorizes a provider click');
  reloaded.close();
  console.log('account-budget-content: reload latch and real tick prevent automatic retry');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
