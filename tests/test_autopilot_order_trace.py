"""AutoFactory #460: order -> send traceability and composer-block reason.

Runs the real content.js in JSDOM. Only ids, codes and counters may leave the tab.
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
const source = fs.readFileSync(process.argv[1], 'utf8');
const SECRET = 'SECRETO-CONVERSACION-123';
function boot(hidden) {
  const dom = new JSDOM('<!doctype html><div style="display:' + (hidden ? 'none' : 'block') +
    '"><div id="prompt-textarea" contenteditable="true">' + SECRET + '</div></div>' +
    '<div data-message-author-role="assistant">' + SECRET + ' #12</div>',
    { url: 'https://chatgpt.com/c/' + SECRET, runScripts: 'outside-only' });
  const w = dom.window; const logs = []; const listeners = []; let now = 100000;
  w.Date.now = () => now;
  w.setInterval = () => 1; w.clearInterval = () => {};
  w.setTimeout = () => 1; w.clearTimeout = () => {};
  w.scrollBy = () => {};
  w.ChatGPTAutopilotCore = { ...require('./autopilot-core.js'),
    pageSignal: () => ({ code: 'ready', action: 'continue' }),
    stopButton: () => null, canSend: () => false, sendButton: () => null };
  w.ChatGPTAutopilotLearning = require('./learning.js');
  w.ChatGPTAutopilotReliability = require('./reliability.js');
  w.ChatGPTAutopilotAdaptiveRecovery = {};
  w.ChatGPTAutopilotBudgetGuard = null;
  w.chrome = { runtime: {
      sendMessage: m => { if (m && m.type === 'autopilot:log') logs.push({ event: m.event, details: m.details }); return Promise.resolve({ ok: true }); },
      getManifest: () => ({ version: 'test' }),
      onMessage: { addListener: l => listeners.push(l) } },
    storage: { local: { get(d, cb) { cb({ ...d, masterEnabled: false }); }, set(_v, cb) { cb && cb(); } },
      onChanged: { addListener() {} } } };
  w.eval(source);
  const send = (msg) => { let r; listeners.forEach(l => l(msg, {}, x => { r = x; })); return r; };
  return { send, logs, advance: ms => { now += ms; }, close: () => w.close() };
}
const pick = (logs, e) => logs.filter(x => x.event === e);
(async () => {
  const out = {};
  const t = boot(true);
  out.reply = t.send({ type: 'autopilot:assign', issue: 'AutoFactory#460', orderId: 777 });
  out.received = pick(t.logs, 'order-received');
  t.advance(30000); t.send({ type: 'autopilot:heartbeat' });
  out.early = pick(t.logs, 'composer-blocked').length;
  t.advance(31000); t.send({ type: 'autopilot:heartbeat' });
  t.send({ type: 'autopilot:heartbeat' });
  out.blocked = pick(t.logs, 'composer-blocked');
  out.all = t.logs;
  t.close();
  const u = boot(false);
  for (const bad of [0, -3, 1.5, '9', null, undefined, 2 ** 60]) {
    u.send({ type: 'autopilot:assign', repo: 'Factory', orderId: bad });
  }
  out.badOrders = pick(u.logs, 'order-received').length;
  u.close();
  console.log(JSON.stringify(out));
})();
"""


class AutopilotOrderTraceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        node = shutil.which("node")
        assert node, "Node 20+ required; no synthetic success"
        proc = subprocess.run(
            [node, "-e", HARNESS, "content.js"], cwd=ROOT, text=True,
            capture_output=True, check=False, timeout=60,
        )
        assert proc.returncode == 0, (proc.stdout + proc.stderr)[-4000:]
        cls.out = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_ac02_order_received_carries_only_the_order_id(self) -> None:
        self.assertTrue(self.out["reply"]["ok"])
        self.assertEqual(self.out["received"],
                         [{"event": "order-received", "details": {"order_id": 777}}])

    def test_ac02_composer_blocked_once_after_60s_with_reason_code(self) -> None:
        self.assertEqual(self.out["early"], 0)
        self.assertEqual(self.out["blocked"], [
            {"event": "composer-blocked", "details": {"order_id": 777, "cmpReason": 5}}])

    def test_ac02_privacy_no_conversation_text_in_trace_events(self) -> None:
        for item in self.out["all"]:
            if item["event"] not in ("order-received", "composer-blocked"):
                continue
            for key, value in item["details"].items():
                self.assertIn(key, ("order_id", "cmpReason"))
                self.assertIsInstance(value, int)
        self.assertNotIn("SECRETO-CONVERSACION", json.dumps(self.out["all"]))

    def test_invalid_order_ids_are_never_traced(self) -> None:
        self.assertEqual(self.out["badOrders"], 0)

    def test_ac01_send_events_carry_order_id_and_commands_forward_it(self) -> None:
        for base in (ROOT, SAFARI):
            content = (base / "content.js").read_text(encoding="utf-8")
            self.assertIn("log('send-start', { promptLength: core.normalize(prompt).length, "
                          "signature, ...orderDetails() })", content)
            self.assertIn("log('send-confirmed', { promptLength: core.normalize(prompt).length, "
                          "signature, ...orderDetails() })", content)
            commands = (base / "factory-control-local-commands.js").read_text(encoding="utf-8")
            self.assertIn("{ type: 'autopilot:assign', issue, orderId }", commands)
            self.assertIn("{ type: 'autopilot:assign', repo: issue, orderId }", commands)
            self.assertIn("command.issue || command.repo, command.id)", commands)

    def test_chrome_safari_mirrors_are_identical(self) -> None:
        for name in ("content.js", "factory-control-local-commands.js"):
            self.assertEqual((ROOT / name).read_bytes(), (SAFARI / name).read_bytes(), name)


if __name__ == "__main__":
    unittest.main()


class BackgroundLogFilterTests(unittest.TestCase):
    """The background log filter must pass ids/codes only and drop any text."""

    SCRIPT = r"""
const fs = require('node:fs');
const store = {};
const listeners = [];
globalThis.chrome = { runtime: { onMessage: { addListener: l => listeners.push(l) },
  onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getManifest: () => ({ version: 't' }) },
  storage: { local: { get: (d, cb) => { const r = { ...d, ...store }; if (cb) cb(r); return Promise.resolve(r); },
    set: (v, cb) => { Object.assign(store, v); if (cb) cb(); return Promise.resolve(); } } },
  tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} }, query: () => Promise.resolve([]) },
  alarms: { onAlarm: { addListener() {} }, create() {}, clear() {} },
  action: {}, windows: {} };
require('./' + process.argv[1]);
(async () => {
  const send = m => new Promise(r => { let done = false;
    for (const l of listeners) { const k = l(m, { tab: { id: 3, url: 'https://chatgpt.com/c/abc' } }, x => { done = true; r(x); }); if (k === true) break; }
    setTimeout(() => r(null), 300); });
  await send({ type: 'autopilot:log', event: 'order-received', details: { order_id: 41, text: 'SECRETO' } });
  await send({ type: 'autopilot:log', event: 'composer-blocked', details: { order_id: 41, cmpReason: 5, prompt: 'SECRETO', note: 'SECRETO' } });
  await send({ type: 'autopilot:log', event: 'send-start', details: { order_id: 41, promptLength: 9, signature: 'abc' } });
  await send({ type: 'autopilot:log', event: 'send-confirmed', details: { order_id: '41 SECRETO' } });
  await new Promise(r => setTimeout(r, 300));
  const log = store.diagnosticLog || [];
  console.log(JSON.stringify(log.map(e => ({ event: e.event, details: e.details }))));
  process.exit(0);
})();
"""

    def test_background_keeps_order_ids_and_drops_text(self) -> None:
        node = shutil.which("node")
        self.assertIsNotNone(node)
        for base in (ROOT, SAFARI):
            proc = subprocess.run([node, "-e", self.SCRIPT, "background.js"], cwd=base,
                                  text=True, capture_output=True, check=False, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertNotIn("SECRETO", proc.stdout)
            events = json.loads(proc.stdout.strip().splitlines()[-1])
            self.assertEqual(events, [
                {"event": "order-received", "details": {"order_id": 41}},
                {"event": "composer-blocked", "details": {"order_id": 41, "cmpReason": 5}},
                {"event": "send-start", "details": {"order_id": 41, "promptLength": 9}},
                {"event": "send-confirmed", "details": {}},
            ])

    def test_background_mirror_is_identical(self) -> None:
        self.assertEqual((ROOT / "background.js").read_bytes(), (SAFARI / "background.js").read_bytes())
