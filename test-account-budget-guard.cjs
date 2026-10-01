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
  window.setInterval = () => 0;
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
          reply({ ok: true, allowed: true, snapshot: readySnapshot(Date.now() + 90000) });
        } else if (message.type === 'autopilot:budget-limit') {
          reply({ ok: true, snapshot: readySnapshot(Date.now() + 90000) });
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

  storageReply({
    masterEnabled: true,
    reasoningLevel: 'high',
    accountBudgetSnapshotV1: readySnapshot()
  });
  assert.equal(window.ChatGPTAutopilotCore.canSend(button), false,
    'first readiness check should reserve shared capacity asynchronously');
  await flush();
  assert.equal(consumeCalls, 1);
  assert.equal(window.ChatGPTAutopilotCore.canSend(button), true,
    'next readiness check should expose the preauthorized send');

  button.click();
  assert.equal(clickEvents, 1, 'authorized programmatic click must remain synchronous');
  button.click();
  assert.equal(clickEvents, 1, 'a second click without authorization must be blocked');
  assert.equal(consumeCalls, 1, 'blocked second click must not bypass the shared budget');
  assert.equal(statusCalls, 0);

  console.log('account-budget-guard: fail-closed initialization and synchronous authorization pass');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
