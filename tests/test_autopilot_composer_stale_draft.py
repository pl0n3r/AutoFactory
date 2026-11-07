"""Offline regression for AutoFactory #469 (directed composer stale drafts).

Runs the real Chrome content script inside JSDOM. All cases use synthetic
commands and text; no browser accounts, network, or production sessions.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAFARI = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"

HARNESS = r"""
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const realCore = require('./autopilot-core.js');
const learning = require('./learning.js');
const reliability = require('./reliability.js');
const source = fs.readFileSync(process.argv[1], 'utf8');
const SECRET = 'BORRADOR-SENSIBLE-CHAT-469';
const OWN = 'Trabajas en el repositorio pl0n3r/AutoFactory. Lee y ejecuta https://github.com/pl0n3r/factory/blob/main/PLAN-AGENTES.md para este repositorio.';

async function boot(kind) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="prompt-textarea" contenteditable="true"></div>' +
    '<button id="send-button">Send</button></body></html>',
    { url: 'https://chatgpt.com/c/synthetic-469', runScripts: 'outside-only' }
  );
  const w = dom.window;
  // The shared core module executes in Node's realm, while the DOM is JSDOM.
  global.InputEvent = w.InputEvent;
  let now = 100000, sent = 0, attempts = 0, lastSentText = '', assistantCount = 0;
  const sentHistory = [];
  const logs = [], listeners = [];
  const field = w.document.getElementById('prompt-textarea');
  const sendButton = w.document.getElementById('send-button');
  w.Date.now = () => now;
  w.scrollBy = () => {};
  w.scrollTo = () => {};
  w.setInterval = () => 1;
  w.clearInterval = () => {};
  w.setTimeout = (callback) => {
    if (kind === 'unconfirmed') setImmediate(() => { now += 8100; callback(); });
    return 1;
  };
  sendButton.click = () => {
    attempts += 1;
    if (kind === 'fail' || kind === 'retry-replaced') throw new Error('synthetic-send-failure');
    if (kind === 'unconfirmed') return;
    if (kind === 'race' && attempts === 1) {
      send({ type: 'autopilot:assign', repo: 'GrindFlow', orderId: 470 });
    }
    lastSentText = realCore.composerText(field);
    sentHistory.push(lastSentText);
    sent += 1;
    realCore.replaceComposerText(field, '', w.document);
  };
  w.ChatGPTAutopilotCore = {
    ...realCore,
    composer: doc => doc.getElementById('prompt-textarea'),
    pageSignal: () => ({ code: 'ready', action: 'continue' }),
    isSafeRecoverySignal: () => false,
    stopButton: () => sent > assistantCount ? sendButton : null,
    recoveryButton: () => null,
    canSend: () => true,
    sendButton: () => sendButton,
    assistantMessageCount: () => assistantCount,
    userMessageCount: () => sent,
    lastUserMessageText: () => lastSentText
  };
  w.ChatGPTAutopilotLearning = learning;
  w.ChatGPTAutopilotReliability = {
    ...reliability,
    afterFailure: value => reliability.afterFailure(value, now),
    save: (store, snapshot) => {
      if (kind === 'persist-fail' && sent > 0) throw new Error('synthetic-persist-failure');
      return reliability.save(store, snapshot);
    }
  };
  w.ChatGPTAutopilotAdaptiveRecovery = {};
  w.ChatGPTAutopilotBudgetGuard = null;
  const stored = {
    masterEnabled: true,
    accountBudgetEnabled: false,
    periodicReload: false,
    modelTarget: 'keep',
    reasoningLevel: 'keep',
    conversationMode: 'chat',
    directedComposerClearAfterMs: 120000
  };
  w.chrome = {
    runtime: {
      getManifest: () => ({ version: 'test' }),
      sendMessage: m => {
        if (m?.type === 'autopilot:log') logs.push({ event: m.event, details: m.details });
        return Promise.resolve({ ok: true });
      },
      onMessage: { addListener(fn) { listeners.push(fn); } }
    },
    storage: {
      local: {
        get(defaults, cb) { cb({ ...defaults, ...stored }); },
        set(_data, cb) { if (cb) cb(); }
      },
      onChanged: { addListener() {} }
    }
  };
  w.eval(source);
  const send = (message) => {
    let reply;
    for (const listener of listeners) listener(message, {}, r => { reply = r; });
    return reply;
  };
  const heartbeat = async (advance = 0) => {
    now += advance;
    send({ type: 'autopilot:heartbeat' });
    for (let i = 0; i < 40; i += 1) await new Promise(resolve => setImmediate(resolve));
  };
  if (['directed', 'fail', 'match', 'unconfirmed', 'race',
       'replaced', 'whitespace', 'persist-fail', 'retry-replaced'].includes(kind)) {
    send({ type: 'autopilot:assign', repo: 'AutoFactory', orderId: 469 });
    field.textContent = ['match', 'unconfirmed', 'race', 'persist-fail'].includes(kind)
      ? OWN : kind === 'whitespace' ? '  ' + SECRET + '  ' : SECRET;
  } else {
    if (kind === 'without-order') send({ type: 'autopilot:directed', on: true });
    field.textContent = SECRET;
  }
  const read = () => ({
    content: realCore.composerText(field),
    attempts, sent, lastSentText, sentHistory: [...sentHistory],
    cleared: logs.filter(e => e.event === 'draft-cleared' && e.details?.code === 'composer-cleared'),
    statuses: logs.filter(e => e.event === 'status').map(e => e.details?.status || ''),
    failures: logs.filter(e => e.event === 'failure').map(e => e.details?.code).filter(Boolean)
  });
  const snapshots = [];
  await heartbeat(6000); // content.js has a 5s startup guard
  await heartbeat(); // the first heartbeat completes interface initialization
  snapshots.push(read());
  if (['directed', 'fail', 'replaced', 'whitespace', 'retry-replaced'].includes(kind)) {
    await heartbeat(119000);
    snapshots.push(read());
    if (kind === 'replaced') {
      field.textContent = 'OTRO-BORRADOR-DIRIGIDO';
      field.dispatchEvent(new w.Event('input', { bubbles: true }));
    }
    await heartbeat(2000);
    snapshots.push(read());
    if (kind === 'replaced') {
      await heartbeat(121000);
      snapshots.push(read());
    }
    if (kind === 'retry-replaced') {
      field.textContent = 'NUEVO-BORRADOR-TRAS-FALLO';
      field.dispatchEvent(new w.Event('input', { bubbles: true }));
      await heartbeat(6000);
      snapshots.push(read());
      await heartbeat(115000);
      field.textContent = 'BORRADOR-SUSTITUIDO-POSFALLO';
      field.dispatchEvent(new w.Event('input', { bubbles: true }));
      await heartbeat(6000);
      snapshots.push(read());
      await heartbeat(121000);
      snapshots.push(read());
    }
    if (kind === 'fail') {
      await heartbeat(600000);
      snapshots.push(read());
      await heartbeat(600000);
      snapshots.push(read());
      await heartbeat(600000);
      snapshots.push(read());
      send({ type: 'autopilot:assign', repo: 'AutoFactory', orderId: 469 });
      await heartbeat(600000);
      snapshots.push(read());
    }
  }
  if (kind === 'manual' || kind === 'without-order') {
    await heartbeat(121000);
    snapshots.push(read());
  }
  if (kind === 'unconfirmed' || kind === 'persist-fail') {
    await heartbeat(600000);
    snapshots.push(read());
  }
  if (kind === 'race') {
    assistantCount = 1;
    await heartbeat(5000);
    snapshots.push(read());
    await heartbeat(20000);
    snapshots.push(read());
  }
  const result = { snapshots, logs };
  w.close();
  return result;
}
(async () => {
  const cases = {};
  for (const kind of ['directed', 'without-order', 'manual', 'match', 'fail',
                      'unconfirmed', 'replaced', 'whitespace', 'race', 'persist-fail',
                      'retry-replaced']) {
    cases[kind] = await boot(kind);
  }
  console.log(JSON.stringify(cases));
})().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
"""


class DirectedComposerStaleDraftTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        node = shutil.which("node")
        assert node, "Node 20+ required"
        proc = subprocess.run(
            [node, "-e", HARNESS, "content.js"],
            cwd=ROOT, capture_output=True, text=True, timeout=75, check=False
        )
        assert proc.returncode == 0, (proc.stdout + "\n" + proc.stderr)[-6000:]
        cls.cases = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_ac01_directed_stale_draft_preserved_until_threshold_then_sent(self):
        before, early, after = self.cases["directed"]["snapshots"]
        self.assertEqual(before["content"], "BORRADOR-SENSIBLE-CHAT-469")
        self.assertEqual(early["content"], "BORRADOR-SENSIBLE-CHAT-469")
        self.assertEqual(before["attempts"], 0)
        self.assertEqual(early["attempts"], 0)
        self.assertEqual(after["attempts"], 1)
        self.assertEqual(after["sent"], 1)
        self.assertIn("pl0n3r/AutoFactory", after["lastSentText"])
        self.assertEqual(len(after["cleared"]), 1)

    def test_ac02_directed_without_order_cannot_clear_manual_draft(self):
        item = self.cases["without-order"]["snapshots"][-1]
        self.assertEqual(item["content"], "BORRADOR-SENSIBLE-CHAT-469")
        self.assertEqual(item["attempts"], 0)
        self.assertFalse(item["cleared"])

    def test_ac02_non_directed_never_clears_manual_draft(self):
        item = self.cases["manual"]["snapshots"][-1]
        self.assertEqual(item["content"], "BORRADOR-SENSIBLE-CHAT-469")
        self.assertEqual(item["attempts"], 0)
        self.assertFalse(item["cleared"])

    def test_ac02_own_draft_resumes_without_clear_event(self):
        item = self.cases["match"]["snapshots"][-1]
        self.assertEqual(item["sent"], 1)
        self.assertEqual(item["attempts"], 1)
        self.assertFalse(item["cleared"])

    def test_ac03_privacy_event_is_only_fixed_code_and_character_count(self):
        item = self.cases["directed"]["snapshots"][-1]
        self.assertEqual(item["cleared"], [{
            "event": "draft-cleared",
            "details": {"code": "composer-cleared",
                        "promptLength": len("BORRADOR-SENSIBLE-CHAT-469")}
        }])
        self.assertNotIn("BORRADOR-SENSIBLE-CHAT-469",
                         json.dumps(self.cases["directed"]["logs"]))
        background = (ROOT / "background.js").read_text(encoding="utf8")
        self.assertIn("'draft-cleared'", background)
        self.assertIn("'promptLength'", background)
        self.assertIn("'code'", background)

    def test_failed_send_after_clear_stops_after_two_retries(self):
        states = self.cases["fail"]["snapshots"]
        self.assertEqual([state["attempts"] for state in states],
                         [0, 0, 1, 2, 3, 3, 3])
        self.assertTrue(any(
            "composer-clear-send-exhausted" in status
            for status in states[-1]["statuses"]
        ))
        self.assertEqual(len(states[-1]["cleared"]), 1)
        self.assertEqual(states[-1]["sent"], 0)

    def test_manual_and_without_order_remain_untouched_after_full_threshold(self):
        for kind in ("manual", "without-order"):
            states = self.cases[kind]["snapshots"]
            self.assertEqual(len(states), 2)
            self.assertEqual(states[-1]["content"], "BORRADOR-SENSIBLE-CHAT-469")
            self.assertEqual(states[-1]["attempts"], 0)
            self.assertFalse(states[-1]["cleared"])

    def test_raw_character_length_keeps_whitespace_without_content(self):
        item = self.cases["whitespace"]["snapshots"][-1]
        self.assertEqual(item["cleared"][0]["details"]["promptLength"],
                         len("  BORRADOR-SENSIBLE-CHAT-469  "))
        self.assertNotIn("BORRADOR-SENSIBLE-CHAT-469",
                         json.dumps(self.cases["whitespace"]["logs"]))

    def test_replaced_draft_waits_for_new_uninterrupted_window(self):
        states = self.cases["replaced"]["snapshots"]
        self.assertEqual(states[2]["attempts"], 0)
        self.assertEqual(states[2]["content"], "OTRO-BORRADOR-DIRIGIDO")
        self.assertEqual(states[-1]["attempts"], 1)
        self.assertEqual(states[-1]["cleared"][0]["details"]["promptLength"],
                         len("OTRO-BORRADOR-DIRIGIDO"))

    def test_ambiguous_send_without_clear_cannot_retry(self):
        states = self.cases["unconfirmed"]["snapshots"]
        self.assertEqual([state["attempts"] for state in states], [1, 1])
        self.assertFalse(states[-1]["cleared"])
        self.assertIn("composer-send-unconfirmed", states[-1]["failures"])
        self.assertTrue(any("composer-send-unconfirmed" in status
                            for status in states[-1]["statuses"]))

    def test_new_assignment_survives_previous_order_confirmation(self):
        states = self.cases["race"]["snapshots"]
        self.assertEqual(states[-1]["sent"], 2)
        self.assertIn("pl0n3r/AutoFactory", states[-1]["sentHistory"][0])
        self.assertIn("pl0n3r/GrindFlow", states[-1]["sentHistory"][1])
        self.assertTrue(any(item["event"] == "order-received"
                            for item in self.cases["race"]["logs"]))

    def test_persistence_failure_cannot_requeue_accepted_order(self):
        states = self.cases["persist-fail"]["snapshots"]
        self.assertEqual([state["attempts"] for state in states], [1, 1])
        self.assertIn("send-state-persist-failed", states[-1]["failures"])

    def test_changed_draft_after_failed_clear_gets_full_timeout(self):
        states = self.cases['retry-replaced']['snapshots']
        self.assertEqual(states[2]['attempts'], 1)
        self.assertEqual(states[3]['attempts'], 1)
        self.assertEqual(states[4]['attempts'], 1)
        self.assertEqual(states[4]['content'], 'BORRADOR-SUSTITUIDO-POSFALLO')
        self.assertEqual(states[5]['attempts'], 2)

    def test_chrome_safari_content_mirror(self):
        self.assertEqual((ROOT / "content.js").read_bytes(),
                         (SAFARI / "content.js").read_bytes())


if __name__ == "__main__":
    unittest.main()
