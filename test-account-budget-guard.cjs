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
