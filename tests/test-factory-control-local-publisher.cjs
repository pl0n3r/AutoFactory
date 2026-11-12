'use strict';
// AutoFactory #467: no real Chrome tab, ChatGPT account or localhost POST.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const publisher = require('../factory-control-local-publisher.js');
const baseline = { instance_id: 'af-test-1', label: 'AutoFactory',
  state: 'activo', chats_open: 1, idle_reason: 'activo' };
const keys = ['last_prompt_s', 'last_reply_s', 'last_reply_chars', 'msgs_hour'];
function contract() {
  const input = { chat_id: 't2', state: 'generando', phase: 'desconocido',
    last_prompt_s: 999999999, last_reply_s: -2, last_reply_chars: 1000001,
    msgs_hour: 10001, text: 'SECRET-CONTENT', title: 'PRIVATE',
    url: 'https://private.example/c/secret' };
  const result = publisher.payloadFrom({ ...baseline, chats: [input] });
  const chat = result.chats[0];
  assert.equal(chat.last_prompt_s, 10000000);
  assert.equal(chat.last_reply_s, 0);
  assert.equal(chat.last_reply_chars, 1000000);
  assert.equal(chat.msgs_hour, 10000);
  assert.deepEqual(keys.every(k => Number.isInteger(chat[k]) && chat[k] >= 0), true);
  assert.equal(JSON.stringify(result).includes('SECRET-CONTENT'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes('private.example'), false);
  const blank = publisher.payloadFrom({ ...baseline, chats: [
    { chat_id: 't1', state: 'generando', phase: 'desconocido',
      last_prompt_s: 0, last_reply_s: 'free text', last_reply_chars: 0, msgs_hour: Number.NaN }
  ] }).chats[0];
  assert.equal(blank.last_reply_chars, 0);
  assert.equal(blank.last_reply_s, 0);
  assert.equal(blank.msgs_hour, 0);
  assert.equal(JSON.stringify(blank).includes('free text'), false);
}
function orqContract() {
  const good = { issue: 'AutoFactory#475', fase: 'pr', pr: 476,
    hecho: 'PR abierto', siguiente: 'Revisar CI', bloqueo: null };
  const packet = orqStatus => publisher.payloadFrom({ ...baseline, chats: [{
    chat_id: 't1', state: 'generando', phase: 'desconocido', orqStatus,
    text: 'SECRET-REPLY', title: 'SECRET-TITLE', url: 'https://secret.invalid/private'
  }] }).chats[0];
  assert.deepEqual(packet(good).status, good);
  for (const bad of [
    { ...good, fase: 'unknown' }, { ...good, issue: 'bad issue' },
    { ...good, pr: '476' }, { ...good, hecho: 'x'.repeat(161) },
    { ...good, siguiente: 'x\u0001y' }, { ...good, fase: 'bloqueado' },
    { ...good, fase: 'parada', bloqueo: null }, { ...good, extra: 'private' },
    { ...good, bloqueo: { secret: 'do-not-send' } }
  ]) assert.equal(Object.hasOwn(packet(bad), 'status'), false);
  assert.doesNotMatch(JSON.stringify(packet(good)), /SECRET|secret.invalid/);
}
function runtime() {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><main><article data-message-author-role="assistant">OLD REPLY</article></main>',
    { url: 'https://chatgpt.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.sessionStorage.setItem('chatgpt-autopilot-runtime-v1',
    JSON.stringify({ lastSentAt: 90000, assistantCountBeforeSend: 1 }));
  window.sessionStorage.setItem('chatgpt-autopilot-runtime-schema', '4');
  let now = 100000;
  window.Date.now = () => now;
  window.setInterval = () => 1;
  window.clearInterval = () => {};
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  window.ChatGPTAutopilotCore = require('../autopilot-core.js');
  window.ChatGPTAutopilotLearning = require('../learning.js');
  window.ChatGPTAutopilotReliability = require('../reliability.js');
  window.ChatGPTAutopilotAdaptiveRecovery = {};
  window.ChatGPTAutopilotBudgetGuard = {};
  const listeners = [];
  window.chrome = {
    runtime: { sendMessage: () => Promise.resolve({ ok: true }),
      getManifest: () => ({ version: 'test' }),
      onMessage: { addListener(fn) { listeners.push(fn); } } },
    storage: { local: {
      get(defaults, callback) { callback({ ...defaults, masterEnabled: false }); },
      set(_values, callback) { callback?.(); } },
      onChanged: { addListener() {} } }
  };
  try {
    window.eval(fs.readFileSync('./content.js', 'utf8'));
    function status() {
      let response;
      for (const fn of listeners) fn({ type: 'autopilot:get-status' }, {}, r => { response = r; });
      assert.ok(response);
      return response;
    }
    const empty = status() ?? {};
    assert.equal(empty.phase, 'desconocido');
    assert.equal(empty.last_reply_chars, 0, 'historical answer is not a reply to latest order');
    assert.equal(empty.last_prompt_s, 10);
    assert.equal(empty.msgs_hour, 1);
    const reply = window.document.createElement('article');
    reply.dataset.messageAuthorRole = 'assistant';
    reply.textContent = 'UNCLASSIFIED SECRET ANSWER';
    window.document.querySelector('main').append(reply);
    const answer = status() ?? {};
    assert.equal(answer.phase, 'desconocido');
    assert.equal(answer.last_reply_chars, reply.textContent.length);
    assert.equal(answer.last_reply_s, 0);
    now += 12000;
    const later = status() ?? {};
    assert.equal(later.last_reply_s, 12);
    assert.equal(later.last_prompt_s, 22);
    const snapshot = publisher.payloadFrom({ ...baseline,
      chats: [{ chat_id: 't1', state: 'generando', phase: later.phase,
        last_prompt_s: later.last_prompt_s, last_reply_s: later.last_reply_s,
        last_reply_chars: later.last_reply_chars, msgs_hour: later.msgs_hour }] });
    const chat = snapshot.chats[0];
    assert.deepEqual(keys.map(k => chat[k]), [22, 12, reply.textContent.length, 1]);
    assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
    assert.equal(JSON.stringify(snapshot).includes('UNCLASSIFIED'), false);
    assert.doesNotMatch(JSON.stringify(snapshot), /https?:\/\//);

    for (const listener of listeners) listener({ type: 'autopilot:directed', on: true }, {}, () => {});
    const valid = { issue: 'AutoFactory#475', fase: 'revision', pr: 476,
      hecho: 'CI verde', siguiente: 'Revisar PR', bloqueo: null };
    reply.textContent = 'PRIVATE CHAT BODY\nORQ-ESTADO: ' + JSON.stringify(valid);
    const signal = status();
    assert.deepEqual(JSON.parse(JSON.stringify(signal.orqStatus)), valid);
    const sent = publisher.payloadFrom({ ...baseline, chats: [
      { chat_id: 't1', state: 'generando', phase: signal.phase,
        orqStatus: JSON.parse(JSON.stringify(signal.orqStatus)), text: reply.textContent,
        title: 'SECRET TITLE', url: 'https://secret.invalid' }] });
    assert.deepEqual(sent.chats[0].status, valid);
    assert.doesNotMatch(JSON.stringify(sent), /PRIVATE CHAT BODY|SECRET|secret.invalid/);
    reply.textContent += '\nORQ-ESTADO: {"fase":"invalid"}';
    assert.equal(status().orqStatus, undefined);
    reply.textContent = 'ORQ-ESTADO: ' + 'x'.repeat(601);
    assert.equal(status().orqStatus, undefined);
    reply.textContent = 'ORQ-ESTADO: ' + JSON.stringify({ ...valid, fase: 'parada' });
    assert.equal(status().orqStatus, undefined);
    reply.textContent = 'ORQ-ESTADO: ' + JSON.stringify({ ...valid, hecho: 'x\u0001y' });
    assert.equal(status().orqStatus, undefined);

  } finally { dom.window.close(); }
}
const selected = process.argv[2];
if (selected === 'contract') contract();
else if (selected === 'runtime') runtime();
else if (selected === 'orq') orqContract();
else throw new Error('unknown telemetry test');
console.log('AutoFactory #467 telemetry ' + selected + ': PASS');
