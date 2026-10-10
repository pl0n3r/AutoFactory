'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function readySnapshot(nextAllowedAt = null) {
  return {
    windowMs: 3600000,
    budget: 40,
    sent: nextAllowedAt ? 1 : 0,
    remaining: nextAllowedAt ? 39 : 40,
    limitEvents: 0,
    highReasoningSends: nextAllowedAt ? 1 : 0,
    nextAllowedAt,
    source: 'default'
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

(async () => {
  const dom = new JSDOM('<!doctype html><button id="send">Send</button>', {
    url: 'https://chatgpt.com/', runScripts: 'outside-only'
  });
  const { window } = dom;
  const button = window.document.getElementById('send');
  let fakeNow = 100000;
  window.Date.now = () => fakeNow;
  window.setInterval = () => 0;
  window.setTimeout = (callback, milliseconds = 0) => {
    fakeNow += Math.max(0, Number(milliseconds) || 0);
    void Promise.resolve().then(callback);
    return 0;
  };

  let storageReply = null;
  let consumeCalls = 0;
  let statusCalls = 0;
  let clickEvents = 0;
  button.addEventListener('click', () => { clickEvents += 1; });

  window.ChatGPTAutopilotCore = {
    canSend: candidate => candidate === button && !candidate.disabled,
    pageSignal: () => ({ code: 'ready', action: 'continue' }),
    sendButton: () => button
  };
  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, reply) {
        if (message.type === 'autopilot:budget-status') {
          statusCalls += 1;
          reply({ ok: true, snapshot: readySnapshot() });
        } else if (message.type === 'autopilot:budget-consume') {
          consumeCalls += 1;
          reply({
            ok: true,
            allowed: true,
            snapshot: readySnapshot(fakeNow + 90000)
          });
        } else if (message.type === 'autopilot:budget-limit') {
          reply({ ok: true, snapshot: readySnapshot(fakeNow + 90000) });
        }
      }
    },
    storage: {
      local: {
        get(_defaults, reply) { storageReply = reply; },
        set(_values, reply) { reply?.(); }
      },
      onChanged: { addListener() {} }
    }
  };

  window.eval(fs.readFileSync('./account-budget-guard.js', 'utf8'));
  assert.equal(window.ChatGPTAutopilotCore.canSend(button), false,
    'guard must fail closed before storage initializes');

  const pacingUntil = fakeNow + 90000;
  storageReply({
    masterEnabled: true,
    accountBudgetEnabled: false,
    reasoningLevel: 'high',
    accountBudgetSnapshotV1: readySnapshot(pacingUntil)
  });
  const guard = window.ChatGPTAutopilotBudgetGuard;
  assert.equal(window.ChatGPTAutopilotCore.canSend(button), true,
    'shared budget must not block sends when disabled');
  assert.equal(await guard.waitUntilReady(), true,
    'disabled shared budget must resolve immediately');

  storageReply({
    masterEnabled: true,
    accountBudgetEnabled: true,
    reasoningLevel: 'high',
    accountBudgetSnapshotV1: readySnapshot(pacingUntil)
  });

  assert.ok(guard && typeof guard.waitUntilReady === 'function');
  assert.equal(guard.nextAllowedAt(), pacingUntil);
  assert.equal(await guard.waitUntilReady(), true,
    'a long shared-budget delay must resolve as normal pacing');
  assert.ok(fakeNow >= pacingUntil,
    'test clock must cross the full ninety-second pacing window');
  assert.equal(consumeCalls, 0,
    'waiting for budget must not consume a slot before content is ready to send');
  assert.equal(clickEvents, 0,
    'waiting for budget must never click the provider send control');
  assert.equal(statusCalls, 1,
    'budget state is refreshed once when the pacing window expires');

  assert.equal(window.ChatGPTAutopilotCore.canSend(button), false,
    'first readiness check should consume shared capacity asynchronously');
  await flush();
  assert.equal(consumeCalls, 1);
  assert.equal(window.ChatGPTAutopilotCore.canSend(button), true,
    'next readiness check should expose the preauthorized send');

  button.click();
  assert.equal(clickEvents, 1, 'authorized programmatic click must remain synchronous');
  button.click();
  assert.equal(clickEvents, 1, 'a second click without authorization must be blocked');
  assert.equal(consumeCalls, 1, 'blocked second click must not bypass the shared budget');
  assert.equal(guard.confirmSent(), true, 'confirmed send releases only this reservation');
  assert.equal(window.sessionStorage.getItem('chatgpt-autopilot-budget-consume-pending-v1'), null,
    'a confirmed provider send clears the pending debit latch');

  console.log('account-budget-guard: long pacing waits without failure or premature click');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});


async function unavailableScenario(mode) {
  const dom = new JSDOM('<!doctype html><button id="send">Send</button>', {
    url: 'https://chatgpt.com/', runScripts: 'outside-only'
  });
  const { window } = dom;
  const button = window.document.getElementById('send');
  let fakeNow = 100000;
  let clickCount = 0;
  let consumeCount = 0;
  let storageReply;
  window.Date.now = () => fakeNow;
  window.setInterval = () => 0;
  window.setTimeout = (callback, milliseconds = 0) => {
    fakeNow += Math.max(0, Number(milliseconds) || 0);
    void Promise.resolve().then(callback);
    return 0;
  };
  window.clearTimeout = () => {};
  button.addEventListener('click', () => { clickCount += 1; });
  window.ChatGPTAutopilotCore = {
    canSend: candidate => candidate === button && !candidate.disabled,
    pageSignal: () => ({ code: 'ready' }),
    sendButton: () => button
  };
  let providerMode = mode;
  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, reply) {
        if (message.type === 'autopilot:budget-consume') consumeCount += 1;
        if (message.type === 'autopilot:budget-status' && providerMode === 'invalid') {
          reply({ ok: true, snapshot: { budget: 'invalid' } });
        }
        if (message.type === 'autopilot:budget-status' && providerMode === 'valid') {
          reply({ ok: true, snapshot: readySnapshot() });
        }
        // 'silent' simulates a service worker that never invokes the callback.
      }
    },
    storage: {
      local: { get(_defaults, callback) { storageReply = callback; } },
      onChanged: { addListener() {} }
    }
  };
  window.eval(fs.readFileSync('./account-budget-guard.js', 'utf8'));
  storageReply({
    masterEnabled: true, accountBudgetEnabled: true,
    reasoningLevel: 'high', accountBudgetSnapshotV1: null
  });
  const decision = await window.ChatGPTAutopilotBudgetGuard.waitUntilReady();
  assert.deepEqual(JSON.parse(JSON.stringify(decision)), {
    ok: false, reason: 'budget_unavailable'
  }, mode + ': unavailable background must fail closed with a typed result');
  assert.ok(fakeNow >= 108000, mode + ': waiting must be bounded by fake clock');
  assert.equal(consumeCount, 0, mode + ': no budget slots can be consumed');
  assert.equal(window.ChatGPTAutopilotCore.canSend(button), false,
    mode + ': no send permission without a valid snapshot');
  assert.equal(clickCount, 0, mode + ': must not click a send control');
  providerMode = 'valid';
  assert.equal(await window.ChatGPTAutopilotBudgetGuard.waitUntilReady(), true,
    mode + ': recovery requires a new valid snapshot, without stale in-flight requests');
  assert.equal(consumeCount, 0, mode + ': recovery alone cannot consume a slot');
}
(async () => {
  await unavailableScenario('invalid');
  await unavailableScenario('silent');
  console.log('account-budget-guard: unavailable service worker fails closed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});


// Regression: an acknowledged debit with a delayed/ambiguous callback must not
// cause another debit until provider delivery is confirmed, even across reload.
async function ambiguousDebitScenario() {
  const create = (persisted = {}) => {
    const dom = new JSDOM('<!doctype html><button id="send">Send</button>', {
      url: 'https://chatgpt.com/', runScripts: 'outside-only'
    });
    const w = dom.window, button = w.document.getElementById('send');
    for (const [key, value] of Object.entries(persisted)) w.sessionStorage.setItem(key, value);
    let now = 100000, debits = 0, clicks = 0, delayedReply;
    w.Date.now = () => now;
    w.setInterval = () => 0;
    w.setTimeout = (fn, ms = 0) => {
      now += Math.max(0, Number(ms)||0);
      void Promise.resolve().then(fn);
      return 1;
    };
    w.clearTimeout = () => {};
    w.ChatGPTAutopilotCore = {
      canSend: item => item === button && !item.disabled,
      pageSignal: () => ({ code: 'ready' }),
      sendButton: () => button
    };
    button.addEventListener('click', () => { clicks++; });
    let replyStorage;
    w.chrome = {
      runtime: {
        lastError: null,
        sendMessage(payload, reply) {
          if (payload.type === 'autopilot:budget-consume') {
            debits++;
            delayedReply = reply;
          } else if (payload.type === 'autopilot:budget-status') {
            reply({ ok: true, snapshot: readySnapshot() });
          }
        }
      },
      storage: {
        local: { get(_defaults, callback) { replyStorage = callback; } },
        onChanged: { addListener() {} }
      }
    };
    w.eval(fs.readFileSync('./account-budget-guard.js', 'utf8'));
    replyStorage({
      masterEnabled: true, accountBudgetEnabled: true,
      reasoningLevel: 'high', accountBudgetSnapshotV1: readySnapshot()
    });
    const persistedState = () => Object.fromEntries(
      Array.from({ length: w.sessionStorage.length }, (_, i) => {
        const key = w.sessionStorage.key(i);
        return [key, w.sessionStorage.getItem(key)];
      })
    );
    return {
      w, button, persistedState,
      canSend: () => w.ChatGPTAutopilotCore.canSend(button),
      debitCount: () => debits, clickCount: () => clicks,
      reply: value => delayedReply?.(value)
    };
  };
  const first = create();
  assert.equal(first.canSend(), false);
  assert.equal(first.debitCount(), 1);
  await flush();
  assert.equal(first.canSend(), false);
  assert.equal(first.debitCount(), 1,
    'timeout of a mutating debit must not retry the ambiguous consume');
  const late = first.reply;
  late({ ok: true, allowed: true, snapshot: readySnapshot() });
  await flush();
  assert.equal(first.debitCount(), 1, 'late callback cannot cause another consume');
  assert.equal(first.clickCount(), 0);
  assert.equal(first.w.sessionStorage.getItem('chatgpt-autopilot-budget-consume-pending-v1'), '1');
  assert.deepEqual(JSON.parse(JSON.stringify(
    await first.w.ChatGPTAutopilotBudgetGuard.waitUntilReady()
  )), { ok: false, reason: 'budget_unavailable' },
  'an ambiguous prior debit blocks pacing before a composer can be modified');
  const reloaded = create(first.persistedState());
  assert.equal(reloaded.canSend(), false);
  await flush();
  assert.equal(reloaded.debitCount(), 0,
    'reload may not replay a previously ambiguous debit');
  assert.equal(reloaded.clickCount(), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(
    await reloaded.w.ChatGPTAutopilotBudgetGuard.waitUntilReady()
  )), { ok: false, reason: 'budget_unavailable' },
  'a reopened tab never replays unknown capacity');

  const denied = create();
  assert.equal(denied.canSend(), false);
  denied.reply({
    ok: true, allowed: false, snapshot: readySnapshot(100500)
  });
  await flush();
  assert.equal(denied.w.sessionStorage.getItem('chatgpt-autopilot-budget-consume-pending-v1'), null,
    'an authoritative denied response must release the no-debit latch');
  assert.equal(denied.clickCount(), 0, 'denial never authorizes a click');
  assert.equal(await denied.w.ChatGPTAutopilotBudgetGuard.waitUntilReady(), true,
    'normal pacing recovers after the denied budget window expires');
  assert.equal(denied.debitCount(), 1, 'denial does not automatically resubmit a consume');
  denied.w.close();
  first.w.close();
  reloaded.w.close();
}

ambiguousDebitScenario().then(() => {
  console.log('account-budget-guard: delayed consume is not charged twice');
}).catch(error => { console.error(error); process.exitCode = 1; });
