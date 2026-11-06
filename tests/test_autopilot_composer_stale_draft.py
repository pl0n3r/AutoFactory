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
  let now = 100000, sent = 0, attempts = 0, lastSentText = '';
  const logs = [], listeners = [];
  const field = w.document.getElementById('prompt-textarea');
  const sendButton = w.document.getElementById('send-button');
  w.Date.now = () => now;
  w.scrollBy = () => {};
  w.scrollTo = () => {};
  w.setInterval = () => 1;
  w.clearInterval = () => {};
  sendButton.click = () => {
    attempts += 1;
    if (kind === 'fail') throw new Error('synthetic-send-failure');
    lastSentText = realCore.composerText(field);
    sent += 1;
    realCore.replaceComposerText(field, '', w.document);
  };
  w.ChatGPTAutopilotCore = {
    ...realCore,
    composer: doc => doc.getElementById('prompt-textarea'),
    pageSignal: () => ({ code: 'ready', action: 'continue' }),
    isSafeRecoverySignal: () => false,
    stopButton: () => sent > 0 ? sendButton : null,
    recoveryButton: () => null,
    canSend: () => true,
    sendButton: () => sendButton,
    assistantMessageCount: () => 0,
    userMessageCount: () => sent,
    lastUserMessageText: () => lastSentText
  };
  w.ChatGPTAutopilotLearning = learning;
  w.ChatGPTAutopilotReliability = reliability;
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
  if (kind === 'directed' || kind === 'fail' || kind === 'match') {
    send({ type: 'autopilot:assign', repo: 'AutoFactory', orderId: 469 });
    field.textContent = kind === 'match' ? OWN : SECRET;
  } else {
    if (kind === 'without-order') send({ type: 'autopilot:directed', on: true });
    field.textContent = SECRET;
  }
  const read = () => ({
    content: realCore.composerText(field),
    attempts, sent, lastSentText,
    cleared: logs.filter(e => e.event === 'draft-cleared' && e.details?.code === 'composer-cleared'),
    statuses: logs.filter(e => e.event === 'status').map(e => e.details?.status || ''),
    failures: logs.filter(e => e.event === 'failure').map(e => e.details?.code).filter(Boolean)
  });
  const snapshots = [];
  await heartbeat(1500);
  snapshots.push(read());
  if (kind === 'directed' || kind === 'fail') {
    await heartbeat(119000);
    snapshots.push(read());
    await heartbeat(2000);
    snapshots.push(read());
    if (kind === 'fail') {
      await heartbeat(600000);
      snapshots.push(read());
      await heartbeat(600000);
      snapshots.push(read());
      await heartbeat(600000);
      snapshots.push(read());
    }
  }
  const result = { snapshots, logs };
  w.close();
  return result;
}
(async () => {
  const cases = {};
  for (const kind of ['directed', 'without-order', 'manual', 'match', 'fail']) {
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
                         [0, 0, 1, 2, 3, 3])
        self.assertTrue(any(
            "composer-clear-send-exhausted" in status
            for status in states[-1]["statuses"]
        ))
        self.assertEqual(len(states[-1]["cleared"]), 1)
        self.assertEqual(states[-1]["sent"], 0)

    def test_chrome_safari_content_mirror(self):
        self.assertEqual((ROOT / "content.js").read_bytes(),
                         (SAFARI / "content.js").read_bytes())


if __name__ == "__main__":
    unittest.main()
