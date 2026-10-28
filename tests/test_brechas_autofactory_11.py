#!/usr/bin/env python3
"""AutoFactory #318: cinco contratos documentales con evidencia sintética.

No es una atestación de release, instalación Chrome/Safari, consentimiento ni
continuidad de una sesión real. Las cinco filas siguen siendo UNKNOWN en vivo.
"""
from __future__ import annotations

import json
import re
import subprocess
import unittest
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
RELEASE_WORKFLOW = ROOT / ".github/workflows/release.yml"
RELEASE_DOC = ROOT / "docs/RELEASE-EVIDENCE.md"
SECURITY_DOC = ROOT / "docs/release-security.md"
KEEPALIVE_DOC = ROOT / "docs/session-keepalive.md"
REQUIREMENTS = (
    "DOC-RELEASE-EVIDENCE-03",
    "DOC-RELEASE-SECURITY-01",
    "DOC-SESSION-KEEPALIVE-01",
    "DOC-SESSION-KEEPALIVE-02",
    "DOC-SESSION-KEEPALIVE-03",
)
UNKNOWN = "UNKNOWN"

# No network, extension, storage, token, browser, account or real conversation.
# Both modules are pure and the values passed below are only fake-clock data.
NODE_PROBE = r"""
'use strict';
const {verifyReleaseEvidence, REQUIRED_CHECKS} =
  require('./scripts/verify-release-evidence.cjs');
const {evaluate, createPolicy, MIN_PACING_S, IDLE_AFTER_S, MAX_RETRIES} =
  require('./factory-control-session-keepalive.js');
const BASE = 10000;
const fixture = () => ({
  chat: {reservation_active:true, reply_complete:true,
    last_prompt_s:9100, last_reply_s:9200, last_activity_s:9300,
    last_reply_chars:37, msgs_hour:4, state:'inactivo',
    identical_read_count:2},
  account: {observed_limit_hour:40, msgs_hour:15, usage_limited:false},
  controls: {enabled:true, manual_pause:false, kill_switch_running:true,
    circuit_breaker_open:false, ambiguous_send:false, session_closed:false},
  history: {retries_s:[]}
});
const policy = createPolicy({now:() => BASE});
const decide = mutate => {
  const snap = fixture();
  if (mutate) mutate(snap);
  return policy.decide(snap);
};
const evidence = {
  tag:'v0.0.0', commit_sha:'a'.repeat(40),
  preflight:'success', publish:'success', chrome_smoke:'success',
  safari_smoke:'success', rollback:'success'
};
const evidenceResult = mutate => {
  const copy = {...evidence};
  if (mutate) mutate(copy);
  return verifyReleaseEvidence(copy);
};
const result = {
  requiredChecks: REQUIRED_CHECKS,
  release: {
    complete:evidenceResult(),
    noRollback:evidenceResult(e => delete e.rollback),
    skippedSafari:evidenceResult(e => e.safari_smoke = 'skipped'),
    failedPreflight:evidenceResult(e => e.preflight = 'failure'),
    unknownChrome:evidenceResult(e => e.chrome_smoke = 'UNKNOWN'),
    forgedExtra:evidenceResult(e => e.verified_in_production = true),
    wrongTag:evidenceResult(e => e.tag = 'latest'),
    malformedSha:evidenceResult(e => e.commit_sha = 'short'),
  },
  session: {
    positive:decide(),
    injectedClock:evaluate(fixture(), BASE),
    missingQuota:decide(s => s.account.observed_limit_hour = null),
    unknownState:decide(s => s.chat.state = 'UNKNOWN'),
    singleRead:decide(s => s.chat.identical_read_count = 1),
    missingReply:decide(s => s.chat.last_reply_s = null),
    staleReply:decide(s => {
      s.chat.last_prompt_s = 9250;
      s.chat.last_reply_s = 9150;
      s.chat.last_activity_s = 9250;
    }),
    unackedRetry:decide(s => s.history.retries_s = [9980]),
    duplicateRetry:decide(s => s.history.retries_s = [9200, 9200]),
    invalidPacing:decide(s => s.controls.min_pacing_s = 59),
    budget:decide(s => s.account.msgs_hour = 32),
    paused:decide(s => s.controls.manual_pause = true),
    noReservation:decide(s => s.chat.reservation_active = false),
    ambiguous:decide(s => s.controls.ambiguous_send = true),
    wait:decide(s => {
      s.chat.last_prompt_s = 9980;
      s.chat.last_reply_s = 9990;
      s.chat.last_activity_s = 9990;
    }),
  },
  settings: {minimumPacing:MIN_PACING_S, idleAfter:IDLE_AFTER_S,
             maxRetries:MAX_RETRIES},
};
process.stdout.write(JSON.stringify(result));
"""


@lru_cache(maxsize=1)
def probe() -> dict:
    process = subprocess.run(
        ["node", "-e", NODE_PROBE],
        cwd=ROOT, text=True, capture_output=True, timeout=20, check=False,
    )
    if process.returncode:
        raise AssertionError(
            "Offline Node probe failed: " + process.stderr[-1200:]
        )
    return json.loads(process.stdout)


def matrix_rows() -> dict[str, list[str]]:
    rows: dict[str, list[str]] = {}
    for line in MATRIX.read_text(encoding="utf-8").splitlines():
        for requirement in REQUIREMENTS:
            if line.startswith(f"| {requirement} ·"):
                if requirement in rows:
                    raise AssertionError(f"{requirement}: duplicate matrix row")
                rows[requirement] = [
                    fragment.strip() for fragment in line.strip().strip("|").split("|")
                ]
    return rows


def operational_evidence(requirement: str, claimed: object = None) -> str:
    """An offline test has no authority to certify an installed/live build."""
    if requirement not in REQUIREMENTS:
        return UNKNOWN
    return UNKNOWN


class BrechasAutofactory11Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        result = probe()
        release = result["release"]
        session = result["session"]
        workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")
        release_doc = RELEASE_DOC.read_text(encoding="utf-8")
        security_doc = SECURITY_DOC.read_text(encoding="utf-8")
        session_doc = KEEPALIVE_DOC.read_text(encoding="utf-8")
        verdicts = {
            "DOC-RELEASE-EVIDENCE-03": (
                release["complete"]["verified"] is True
                and set(result["requiredChecks"]) ==
                {"preflight", "publish", "chrome_smoke", "safari_smoke", "rollback"}
                and release["noRollback"]["verified"] is False
                and release["skippedSafari"]["verified"] is False
                and "1.7.0 shared adaptive learning observation gate" in release_doc
                and "rollback" in release_doc
            ),
            "DOC-RELEASE-SECURITY-01": (
                release["failedPreflight"]["verified"] is False
                and release["unknownChrome"]["verified"] is False
                and release["wrongTag"]["verified"] is False
                and "contents: read" in workflow
                and "contents: write" in workflow
                and "Verify tagged commit is current main" in workflow
                and "Recheck current main immediately before packaging" in workflow
                and "needs: [preflight, chrome_smoke, safari_smoke]" in workflow
                and "npm ci --ignore-scripts" in workflow
                and "Puerta de publicación" in security_doc
            ),
            "DOC-SESSION-KEEPALIVE-01": (
                session["positive"]["action"] == "reenganchar"
                and session["positive"]["continuation"] is not None
                and session["positive"] == session["injectedClock"]
                and session["wait"]["action"] == "esperar"
                and session["paused"]["action"] == "detener"
                and result["settings"] ==
                {"minimumPacing": 60, "idleAfter": 600, "maxRetries": 3}
                and "solo es una recomendación" in session_doc
            ),
            "DOC-SESSION-KEEPALIVE-02": (
                session["missingQuota"]["idle_reason"] == "desconocido"
                and session["singleRead"]["idle_reason"] == "desconocido"
                and session["staleReply"]["idle_reason"] == "desconocido"
                and session["budget"]["idle_reason"] == "limite_horario"
                and session["noReservation"]["idle_reason"] == "sin_trabajo"
                and "80 %" in session_doc
                and "identical_read_count" in session_doc
            ),
            "DOC-SESSION-KEEPALIVE-03": (
                session["positive"]["idle_reason"] == "activo"
                and session["ambiguous"]["idle_reason"] == "envio_ambiguo_5min"
                and session["paused"]["idle_reason"] == "pausa_manual"
                and session["unackedRetry"]["idle_reason"] == "desconocido"
                and set(session["positive"]) == {
                    "action", "idle_reason", "idle_since", "next_allowed_s",
                    "last_prompt_s", "last_reply_s", "last_reply_chars",
                    "msgs_hour", "state", "continuation",
                }
                and "Motivos y telemetría limitada" in session_doc
            ),
        }
        self.assertEqual(set(verdicts), set(REQUIREMENTS))
        for requirement, accepted in verdicts.items():
            with self.subTest(requirement=requirement):
                self.assertTrue(accepted, f"{requirement}: offline contract unproven")

    def test_falla_cerrado(self) -> None:
        result = probe()
        for case in ("noRollback", "skippedSafari", "failedPreflight",
                     "unknownChrome", "forgedExtra", "wrongTag", "malformedSha"):
            with self.subTest(release=case):
                self.assertIs(result["release"][case]["verified"], False)
        for case in ("missingQuota", "unknownState", "singleRead", "missingReply",
                     "staleReply", "unackedRetry", "duplicateRetry",
                     "invalidPacing"):
            with self.subTest(session=case):
                outcome = result["session"][case]
                self.assertEqual(outcome["action"], "detener")
                self.assertEqual(outcome["idle_reason"], "desconocido")
                self.assertIsNone(outcome["continuation"])
        for case in ("budget", "paused", "noReservation", "ambiguous"):
            with self.subTest(session=case):
                self.assertEqual(result["session"][case]["action"], "detener")
        for requirement in REQUIREMENTS:
            self.assertEqual(operational_evidence(requirement), UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        """The probe only invokes two pure local modules with synthetic clocks."""
        self.assertNotIn("fetch(", NODE_PROBE)
        self.assertNotIn("http.request", NODE_PROBE)
        self.assertNotIn("https.request", NODE_PROBE)
        self.assertNotIn("sendMessage(", NODE_PROBE)
        self.assertNotIn("localStorage", NODE_PROBE)
        output = json.dumps(probe(), ensure_ascii=False)
        for forbidden in (
            "chat_id", "conversation_id", "access_token", "authorization",
            "cookie", "user_email", "api_key", "browser_tab_url",
        ):
            with self.subTest(field=forbidden):
                self.assertNotIn(forbidden, output.lower())
        self.assertRegex(probe()["release"]["complete"]["reason"], r"required release evidence")

    def test_estados_unknown_explicitos(self) -> None:
        """Offline behavior cannot assert a live release or browser session."""
        rows = matrix_rows()
        self.assertEqual(set(rows), set(REQUIREMENTS))
        for requirement, row in rows.items():
            with self.subTest(requirement=requirement):
                self.assertEqual(len(row), 5)
                self.assertIn(row[2], {"NO_VERIFICABLE", "EN_CURSO", "CUBIERTO"})
                self.assertEqual(operational_evidence(requirement), UNKNOWN)
                self.assertEqual(
                    operational_evidence(requirement, {"live": "success"}),
                    UNKNOWN,
                )
                if row[2] == "NO_VERIFICABLE":
                    self.assertIn("UNKNOWN", row[3])
        # Even a complete synthetic release-evidence object is not real proof.
        self.assertTrue(probe()["release"]["complete"]["verified"])
        self.assertEqual(
            operational_evidence("DOC-RELEASE-EVIDENCE-03", probe()["release"]),
            UNKNOWN,
        )


if __name__ == "__main__":
    unittest.main()
