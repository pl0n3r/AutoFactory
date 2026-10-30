"""Issue #430: solo adaptadores locales ficticios, sin red o credenciales."""
from __future__ import annotations
import json
import subprocess
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]

RUNNER = r"""
const {createFactoryControlKillSwitch} = require('./factory-control-kill-switch.js');
const kind = process.argv[1];
const calls = [];
let queue = [{id:'fake-one'}, {id:'fake-two'}];
let token = 'FAKE_ONLY';
let release;
const hang = new Promise(resolve => { release = resolve; });
let restoreCount = 0, sent = 0;
const sw = createFactoryControlKillSwitch({
  now: () => Date.parse('2026-10-30T17:00:00Z'),
  rollbackTimeoutMs: 15,
  executeCommand: () => { sent++; return kind === 'inflight' ? hang : true; },
  stopBridge: () => { calls.push('stop'); queue = []; return kind === 'timeout' ? hang : true; },
  revokePairing: () => {
    calls.push('revoke'); token = null;
    if (kind === 'exception') throw Error('FAKE_SECRET_NEVER_PRINT');
    return kind !== 'rejected';
  },
  restoreSafeState: () => { calls.push('restore'); restoreCount++; return true; }
});
(async () => {
  const inFlight = kind === 'inflight' ? sw.dispatch({private:'FAKE_MESSAGE'}) : null;
  const one = sw.kill();
  const two = sw.kill();
  const evidence = await one;
  const after = await sw.dispatch({private:'FAKE_MESSAGE'});
  const inflightReceipt = inFlight ? await inFlight : null;
  release(true);
  process.stdout.write(JSON.stringify({
    evidence, after, inflightReceipt, idempotent:one===two,
    calls, queue, token, restoreCount, sent, status:sw.status()
  }));
})().catch(() => process.exit(2));
"""

def run_case(name: str) -> dict:
    command = subprocess.run(
        ["node", "-e", RUNNER, name],
        cwd=ROOT, text=True, capture_output=True, timeout=12, check=False
    )
    if command.returncode:
        raise AssertionError(command.stdout + command.stderr)
    return json.loads(command.stdout)

class KillSwitchPairingTests(unittest.TestCase):
    def test_apaga_emparejamiento_y_descarta_ordenes_sin_controlbot(self):
        data = run_case("normal")
        self.assertEqual(data["calls"], ["stop", "revoke", "restore"])
        self.assertEqual(data["queue"], [])
        self.assertIsNone(data["token"])
        self.assertEqual(data["evidence"]["status"], "safe")
        self.assertEqual(data["after"], {"ok":False, "code":"stopped"})
        self.assertTrue(data["idempotent"])
        self.assertEqual(data["sent"], 0)

    def test_inflight_abort_no_declara_safe(self):
        data = run_case("inflight")
        self.assertEqual(data["inflightReceipt"], {"ok":False,"code":"stopped"})
        self.assertEqual(data["evidence"]["abortedCommands"], 1)
        self.assertEqual(data["evidence"]["status"], "rollback_failed")
        self.assertEqual(data["sent"], 1)

    def test_fallo_revocacion_no_es_seguro(self):
        data = run_case("rejected")
        self.assertEqual(data["evidence"]["status"], "rollback_failed")
        self.assertFalse(data["evidence"]["pairingRevoked"])
        self.assertEqual(data["after"]["code"], "stopped")

    def test_timeout_no_restauracion_prematura(self):
        data = run_case("timeout")
        self.assertEqual(data["evidence"]["status"], "rollback_failed")
        self.assertEqual(data["evidence"]["reason"], "rollback_not_attempted_due_to_unconfirmed_stop")
        self.assertEqual(data["restoreCount"], 0)
        self.assertTrue(data["status"]["stopped"])

    def test_registro_colombia_12h_y_sin_secretos(self):
        data = run_case("exception")
        self.assertNotIn("FAKE_SECRET_NEVER_PRINT", json.dumps(data))
        self.assertNotIn("FAKE_MESSAGE", json.dumps(data))
        self.assertEqual(data["evidence"]["status"], "rollback_failed")
        stamp = data["evidence"]["observedAt"] / 1000
        moment = datetime.fromtimestamp(stamp, ZoneInfo("America/Bogota"))
        self.assertEqual(moment.strftime("%Y-%m-%d %I:%M %p"),
                         "2026-10-30 12:00 PM")
        self.assertIn("Offline coordination contract",
                      (ROOT / "factory-control-kill-switch.js").read_text())

if __name__ == "__main__":
    unittest.main()
