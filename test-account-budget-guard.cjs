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


async function unavailableScenario(mode, invalidSnapshot = { budget: 'invalid' }) {
  const dom = new JSDOM('<!doctype html><button id="send">Send</button>', {
    url: 'https://chatgpt.com/', runScripts: 'outside-only'
  });
  const { window } = dom;
  const button = window.document.getElementById('send');
  let fakeNow = 100000;
  let clickCount = 0;
  let consumeCount = 0;
  let storageReply;
  let storageChanged;
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
          reply({ ok: true, snapshot: invalidSnapshot });
        }
        if (message.type === 'autopilot:budget-status' && providerMode === 'valid') {
          reply({ ok: true, snapshot: readySnapshot() });
        }
        // 'silent' simulates a service worker that never invokes the callback.
      }
    },
    storage: {
      local: { get(_defaults, callback) { storageReply = callback; } },
      onChanged: { addListener(listener) { storageChanged = listener; } }
    }
  };
  window.eval(fs.readFileSync('./account-budget-guard.js', 'utf8'));
  storageReply({
    masterEnabled: true, accountBudgetEnabled: true,
    reasoningLevel: 'high',
    accountBudgetSnapshotV1: mode === 'invalid' ? readySnapshot() : null
  });
  const guard = window.ChatGPTAutopilotBudgetGuard;
  if (mode === 'invalid') {
    assert.equal(await guard.waitUntilReady(), true,
      'a valid initial snapshot establishes readiness before corruption');
    storageChanged({ accountBudgetSnapshotV1: { newValue: invalidSnapshot } }, 'local');
    assert.equal(window.ChatGPTAutopilotCore.canSend(button), false,
      'a contradictory update must revoke previously accepted capacity');
    assert.equal(consumeCount, 0,
      'snapshot corruption must not trigger a debit after invalidation');
  }
  const decision = await guard.waitUntilReady();
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
  const invalidSnapshots = [
    { ...readySnapshot(), budget: 0, remaining: 4 },
    { ...readySnapshot(), sent: 2, remaining: 40 },
    { ...readySnapshot(), sent: 1, remaining: 39, highReasoningSends: 3 },
    { ...readySnapshot(), windowMs: 0 },
    { budget: 'invalid' }
  ];
  for (const invalidSnapshot of invalidSnapshots) {
    await unavailableScenario('invalid', invalidSnapshot);
  }
  await unavailableScenario('silent');
  console.log('account-budget-guard: invalid and internally contradictory snapshots fail closed');
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


// #161: refresh-status failures revoke an already-consumed local send grant,
// and delayed consume callbacks cannot restore it after a denial.
async function refreshRevocationScenario(mode) {
  const dom = new JSDOM('<!doctype html><button id="send">Send</button>', {
    url: 'https://chatgpt.com/', runScripts: 'outside-only'
  });
  const w = dom.window, button = w.document.getElementById('send');
  let interval, storageReply, onStorageChanged, delayedConsume;
  let clicks = 0, consumes = 0, statuses = 0;
  w.Date.now = () => 100000;
  w.setInterval = fn => { interval = fn; return 1; };
  w.setTimeout = () => 1;
  w.clearTimeout = () => {};
  button.addEventListener('click', () => { clicks++; });
  const initial = readySnapshot();
  const consumed = { ...initial, sent: 1, remaining: 39 };
  w.ChatGPTAutopilotCore = {
    canSend: candidate => candidate === button && !candidate.disabled,
    pageSignal: () => ({ code: 'ready' }),
    sendButton: () => button
  };
  w.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (message.type === 'autopilot:budget-consume') {
          consumes++;
          if (mode === 'late-consume' || mode === 'late-consume-denied' || mode === 'toggle-account') {
            delayedConsume = callback;
          } else {
            callback({ ok: true, allowed: true, snapshot: consumed });
          }
        } else if (message.type === 'autopilot:budget-status') {
          statuses++;
          if (mode === 'status-denied' || mode === 'late-consume' || mode === 'late-consume-denied') {
            callback({ ok: false });
          } else if (mode === 'transport-error') {
            w.chrome.runtime.lastError = { message: 'test-only' };
            callback(undefined);
            w.chrome.runtime.lastError = null;
          } else if (mode === 'invalid-snapshot') {
            callback({ ok: true, snapshot: { ...initial, remaining: -1 } });
          } else {
            callback({ ok: true, snapshot: consumed });
          }
        }
      }
    },
    storage: {
      local: { get(_defaults, callback) { storageReply = callback; } },
      onChanged: { addListener(listener) { onStorageChanged = listener; } }
    }
  };
  w.eval(fs.readFileSync('./account-budget-guard.js', 'utf8'));
  storageReply({
    masterEnabled: true, accountBudgetEnabled: true,
    reasoningLevel: 'high', accountBudgetSnapshotV1: initial
  });
  assert.equal(w.ChatGPTAutopilotCore.canSend(button), false);
  await flush();
  await flush();
  if (!delayedConsume) {
    assert.equal(w.ChatGPTAutopilotCore.canSend(button), true,
      mode + ': consume initially authorizes a single send');
  }
  if (mode === 'toggle-account') {
    onStorageChanged({ accountBudgetEnabled: { newValue: false } }, 'local');
    onStorageChanged({ accountBudgetEnabled: { newValue: true } }, 'local');
  } else if (mode === 'reasoning-level-change') {
    onStorageChanged({ reasoningLevel: { oldValue: 'high', newValue: 'low' } }, 'local');
  } else {
    interval();
  }
  await flush();
  await flush();
  if (delayedConsume) {
    delayedConsume({ ok: true, allowed: mode !== 'late-consume-denied', snapshot: consumed });
    await flush();
    await flush();
  }
  if (mode === 'healthy') {
    assert.equal(w.ChatGPTAutopilotCore.canSend(button), true);
    button.click();
    button.click();
    assert.equal(clicks, 1, 'one authorized click remains permitted');
    assert.equal(w.ChatGPTAutopilotBudgetGuard.confirmSent(), true);
  } else {
    assert.equal(w.ChatGPTAutopilotCore.canSend(button), false,
      mode + ': stale grant or delayed consume must be revoked');
    button.click();
    assert.equal(clicks, 0, mode + ': never click under untrusted status');
    assert.equal(w.sessionStorage.getItem('chatgpt-autopilot-budget-consume-pending-v1'),
      mode === 'late-consume-denied' ? null : '1',
      mode + ': only a canonical no-debit denial may clear the pending latch');
  }
  assert.equal(consumes, 1, mode + ': no second consume/replay');
  if (mode !== 'toggle-account' && mode !== 'reasoning-level-change') {
    assert.equal(statuses, 1, mode);
  }
  w.close();
}
// #161 AC-01: a silent status query that times out must revoke a valid grant.
async function refreshTimeoutAfterGrantScenario() {
  const dom = new JSDOM('<!doctype html><button id="send">Send</button>', {
    url: 'https://chatgpt.com/', runScripts: 'outside-only'
  });
  const w = dom.window, button = w.document.getElementById('send');
  let interval, storageReply, consumes = 0, clicks = 0, statuses = 0;
  const timers = [];
  w.Date.now = () => 100000;
  w.setInterval = fn => { interval = fn; return 1; };
  w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  w.clearTimeout = () => {};
  button.addEventListener('click', () => { clicks++; });
  const initial = readySnapshot();
  const consumed = { ...initial, sent: 1, remaining: 39 };
  w.ChatGPTAutopilotCore = {
    canSend: candidate => candidate === button && !candidate.disabled,
    pageSignal: () => ({ code: 'ready' }),
    sendButton: () => button
  };
  w.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, cb) {
        if (message.type === 'autopilot:budget-consume') {
          consumes++;
          cb({ ok: true, allowed: true, snapshot: consumed });
        } else if (message.type === 'autopilot:budget-status') {
          statuses++; // Deliberately never replies: simulate service worker timeout.
        }
      }
    },
    storage: {
      local: { get(_defaults, cb) { storageReply = cb; } },
      onChanged: { addListener() {} }
    }
  };
  w.eval(fs.readFileSync('./account-budget-guard.js', 'utf8'));
  storageReply({
    masterEnabled: true, accountBudgetEnabled: true,
    reasoningLevel: 'high', accountBudgetSnapshotV1: initial
  });
  assert.equal(w.ChatGPTAutopilotCore.canSend(button), false);
  await flush();
  await flush();
  assert.equal(w.ChatGPTAutopilotCore.canSend(button), true, 'grant existed before timeout');
  interval();
  const timeout = timers.find(item => item.ms === 2000);
  assert.ok(timeout, 'status query has a bounded two-second runtime timeout');
  timeout.fn();
  await flush();
  await flush();
  assert.equal(w.ChatGPTAutopilotCore.canSend(button), false);
  button.click();
  assert.equal(clicks, 0, 'timed-out status may never leave a grant live');
  assert.equal(consumes, 1, 'a failed status may not auto-reconsume');
  assert.equal(statuses, 1);
  assert.equal(w.sessionStorage.getItem('chatgpt-autopilot-budget-consume-pending-v1'), '1',
    'timeout is not evidence that prior debit can be cleared');
  w.close();
}

// #161 AC-02: old account status must not re-enable readiness after alias switch.
async function staleRefreshAfterAccountSwitchScenario() {
  const dom = new JSDOM('<!doctype html><button id="send">Send</button>', {
    url: 'https://chatgpt.com/', runScripts: 'outside-only'
  });
  const w = dom.window, button = w.document.getElementById('send');
  let interval, storageReply, storageChanged;
  let statuses = 0, consumes = 0, clicks = 0;
  const statusReplies = [];
  const initial = readySnapshot();
  const consumed = { ...initial, sent: 1, remaining: 39 };
  button.addEventListener('click', () => { clicks++; });
  w.Date.now = () => 100000;
  w.setInterval = fn => { interval = fn; return 1; };
  w.setTimeout = () => 1;
  w.clearTimeout = () => {};
  w.ChatGPTAutopilotCore = {
    canSend: candidate => candidate === button && !candidate.disabled,
    pageSignal: () => ({ code: 'ready' }),
    sendButton: () => button
  };
  w.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, reply) {
        if (message.type === 'autopilot:budget-status') {
          statuses++;
          statusReplies.push(reply);
        } else if (message.type === 'autopilot:budget-consume') {
          consumes++;
          reply({ ok: true, allowed: true, snapshot: consumed });
        }
      }
    },
    storage: {
      local: { get(_defaults, cb) { storageReply = cb; } },
      onChanged: { addListener(fn) { storageChanged = fn; } }
    }
  };
  w.eval(fs.readFileSync('./account-budget-guard.js', 'utf8'));
  storageReply({
    masterEnabled: true, accountBudgetEnabled: true,
    reasoningLevel: 'high', accountBudgetSnapshotV1: initial
  });
  interval(); // status read belonging to account_A remains pending
  assert.equal(statusReplies.length, 1);
  storageChanged({
    accountBudgetAccountAlias: { oldValue: 'fixture_A', newValue: 'fixture_B' }
  }, 'local');
  assert.equal(statusReplies.length, 1, 'new account must not share valid evidence of the prior account');
  statusReplies.shift()({ ok: true, snapshot: initial }); // stale account_A reply
  await flush();
  await flush();
  assert.equal(w.ChatGPTAutopilotCore.canSend(button), false);
  assert.equal(consumes, 0,
    'a valid-looking but stale account_A snapshot must not debit account_B');
  button.click();
  assert.equal(clicks, 0, 'stale response must never authorize a send');
  interval(); // a distinct fresh status query may safely recover account_B
  assert.equal(statusReplies.length, 1);
  statusReplies.shift()({ ok: true, snapshot: initial });
  await flush();
  await flush();
  assert.equal(w.ChatGPTAutopilotCore.canSend(button), false);
  await flush();
  await flush();
  assert.equal(w.ChatGPTAutopilotCore.canSend(button), true);
  button.click();
  button.click();
  assert.equal(clicks, 1, 'fresh account evidence allows exactly one fake click');
  assert.equal(consumes, 1, 'at most one debit after fresh status');
  assert.equal(statuses, 2, 'stale and fresh status calls are separate');
  w.close();
}

(async () => {
  await refreshRevocationScenario('status-denied');
  await refreshRevocationScenario('transport-error');
  await refreshTimeoutAfterGrantScenario();
  console.log('AF161-FAILED-STATUS-REVOKES');
  await refreshRevocationScenario('invalid-snapshot');
  await refreshRevocationScenario('late-consume');
  await refreshRevocationScenario('late-consume-denied');
  await refreshRevocationScenario('toggle-account');
  await refreshRevocationScenario('reasoning-level-change');
  await staleRefreshAfterAccountSwitchScenario();
  console.log('AF161-RACES-FAIL-CLOSED');
  await refreshRevocationScenario('healthy');
  console.log('AF161-HEALTHY');
})().catch(error => { console.error(error); process.exitCode = 1; });
