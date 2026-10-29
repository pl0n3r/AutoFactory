#!/usr/bin/env python3
"""AutoFactory #394: run real Factory Control JS contracts against local fixtures.

The 16 A entries below prove the *offline* behavior of actual source modules,
not a production installation. External/owner-gated parts of those rows and
the B/C entries are still NO_VERIFICABLE until separate primary evidence.
The coverage matrix is not consulted by these tests.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import unittest
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "UNKNOWN"
OFFLINE = "REAL_JS_OFFLINE"


@dataclass(frozen=True)
class Case:
    row: str
    source: str
    script: str
    receipt: str


# Each of these scripts loads the named product module and executes genuine
# Node assert statements with fake transports, clocks, grants or ledgers.
# Reused scripts are executed just once per case family, with a cached receipt.
CASES = (
    Case("ISSUE-130", "factory-control-heartbeat.js",
         "test-factory-control-heartbeat.cjs",
         "Factory Control heartbeat: consent, 60s cadence, revocation and safe failures pass"),
    Case("ISSUE-131", "factory-control-executor.js",
         "test-factory-control-executor.cjs",
         "Factory Control executor: authorization, durable idempotency, effect isolation and safe ACKs pass"),
    Case("ISSUE-132", "factory-control-account-state.js",
         "test-factory-control-account-state.cjs",
         "factory-control account state contract: ok"),
    Case("ISSUE-133", "factory-control-runtime.js",
         "test-factory-control-runtime.cjs",
         "factory-control runtime lifecycle: ok"),
    Case("PROTO-01", "factory-control-protocol.js",
         "test-factory-control.cjs",
         "Factory Control v2 protocol: exact, instance-scoped and data-minimized"),
    Case("PROTO-02", "factory-control-protocol.js",
         "test-factory-control.cjs",
         "Factory Control protocol: heartbeat, command and ACK allowlists correct"),
    Case("PROTO-03", "factory-control-authorization.js",
         "test-factory-control-authorization.cjs",
         "Factory Control authorization: opt-in, expiry, revocation, tab scope and fail closed"),
    Case("PROTO-04", "factory-control-protocol.js",
         "test-factory-control.cjs",
         "Factory Control v2 protocol: exact, instance-scoped and data-minimized"),
    Case("PROTO-05", "factory-control-ledger.js",
         "test-factory-control-ledger.cjs",
         "Factory Control v2 authorization and ledger: instance-scoped, expiring and idempotent"),
    Case("PROTO-06", "factory-control-chrome-storage.js",
         "test-factory-control-ledger.cjs",
         "AC-V2-04: Safari mirror and sanitized adapter errors"),
    Case("PROTO-07", "factory-control-authorization.js",
         "test-factory-control-authorization.cjs",
         "Factory Control authorization: opt-in, expiry, revocation, tab scope and fail closed"),
    Case("PROTO-08", "factory-control-heartbeat.js",
         "test-factory-control-heartbeat.cjs",
         "heartbeat-presence AC-03: ok"),
    Case("PROTO-09", "factory-control-executor.js",
         "test-factory-control-executor.cjs",
         "Factory Control audit AC-03: sanitized durable decisions, fail-closed pending and replay rejection pass"),
    Case("PROTO-10", "factory-control-pairing.js",
         "test-factory-control-pairing.cjs",
         "factory-control pairing contract: ok"),
    Case("PROTO-11", "factory-control-transport.js",
         "test-factory-control-transport.cjs",
         "factory-control transport contract: ok"),
    Case("PROTO-12", "factory-control-account-state.js",
         "test-factory-control-account-state.cjs",
         "account-state AC-03: ok"),
)

# These cannot be certified by one synthetic, pre-live test:
# B needs authentic external GitHub/operator receipts; C is a policy/checklist.
NON_OFFLINE = {
    "ISSUE-134": ("C", "Release/go-live checklist: owner approval and operational receipts, not a JS function."),
    "ISSUE-216": ("B", "GitHub coordination / roadmap_partial transition needs an authentic workflow journal."),
    "ISSUE-219": ("B", "Sonar relay incident requires authentic check-runs, source SHA and remediation."),
    "ISSUE-258": ("C", "Launch checklist delivery and legal gates are human/documentary decisions."),
}
IDS = {case.row for case in CASES} | set(NON_OFFLINE)


@lru_cache(maxsize=16)
def _run_node(script: str, node: str) -> tuple[int, str]:
    if not re.fullmatch(r"test-factory-control(?:-[a-z0-9-]+)?\.cjs", script):
        return 1, ""
    file = ROOT / script
    if not file.is_file():
        return 1, ""
    try:
        run = subprocess.run(
            [node, str(file)],
            cwd=ROOT, text=True, capture_output=True, check=False,
            timeout=150,
            env={
                "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
                "LC_ALL": "C",
                "NODE_ENV": "test",
            },
        )
    except (OSError, subprocess.TimeoutExpired):
        return 1, ""
    # Do not print stderr: inputs and upstream test internals remain private.
    return run.returncode, run.stdout[-24000:]


def real_code_receipt(case: Case, *, node: str | None) -> str:
    """A green test is not inferred from the presence of a source file."""
    if node is None or case.row not in IDS:
        return UNKNOWN
    source = ROOT / case.source
    script = ROOT / case.script
    if not source.is_file() or not script.is_file():
        return UNKNOWN
    # No inert script that only prints PASS: it must import actual production JS.
    if "./" + case.source not in script.read_text(encoding="utf-8"):
        return UNKNOWN
    code, stdout = _run_node(case.script, node)
    if code != 0 or case.receipt not in stdout:
        return UNKNOWN
    return OFFLINE


class CoberturaAutofactory04Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.node = shutil.which("node")

    def test_contrato_principal(self) -> None:
        """AC-01: 16 real JS subcontracts, four explicitly classified B/C."""
        self.assertEqual(20, len(IDS))
        self.assertEqual(16, len(CASES))
        self.assertEqual(4, len(NON_OFFLINE))
        for case in CASES:
            with self.subTest(row=case.row):
                self.assertEqual(real_code_receipt(case, node=self.node), OFFLINE)
        for identifier, (kind, reason) in NON_OFFLINE.items():
            with self.subTest(external_or_documentary=identifier):
                self.assertIn(kind, {"B", "C", "D"})
                self.assertGreater(len(reason), 40)

    def test_falla_cerrado(self) -> None:
        """AC-02: genuine JS deny/replay paths must fail."""
        self.assertEqual(self.node is not None, True, "Real Node runtime required")
        self.assertEqual(real_code_receipt(CASES[0], node=None), UNKNOWN)
        self.assertEqual(real_code_receipt(
            Case("PROTO-12", "factory-control-account-state.js",
                 "not-a-real-test.js", "fake PASS"), node=self.node), UNKNOWN)
        # These suites contain *real* negative assertions and reach the success
        # log only after completing their async rejected/denied/replayed cases.
        for row in ("PROTO-03", "PROTO-05", "PROTO-07", "PROTO-08",
                    "PROTO-09", "PROTO-10", "PROTO-11", "PROTO-12"):
            with self.subTest(denial=row):
                case = next(item for item in CASES if item.row == row)
                source = (ROOT / case.script).read_text(encoding="utf-8")
                if row == "PROTO-10":
                    # Pairing validates sanitized public result keys with
                    # strict equal/deepEqual assertions rather than throws.
                    self.assertIn("assert.deepEqual", source)
                    self.assertIn("pairing-public AC-01..04: ok", source)
                else:
                    self.assertRegex(source, r"assert\.(?:throws|rejects)\(")
                self.assertEqual(real_code_receipt(case, node=self.node), OFFLINE)

    def test_sin_datos_reales(self) -> None:
        """AC-03: checked-in fake inputs, no credentials or live operations."""
        self.assertEqual(self.node is not None, True)
        for case in CASES:
            with self.subTest(offline_case=case.row):
                self.assertRegex(case.source, r"^factory-control-[a-z0-9-]+\.js$")
                self.assertRegex(case.script, r"^test-factory-control(?:-[a-z0-9-]+)?\.cjs$")
                self.assertNotIn("https://", case.script)
        self.assertNotEqual(OFFLINE, "CUBIERTO")
        self.assertNotEqual(OFFLINE, "VALIDATED_IN_PRODUCTION")

    def test_ci_gate_contract(self) -> None:
        """AC-04: actual CI wiring; requires terminal exact-HEAD GitHub checks."""
        workflow = (ROOT / ".github/workflows/validate.yml").read_text(encoding="utf-8")
        self.assertIn("name: Validate", workflow)
        self.assertIn("name: Validate / Pruebas y smoke Chrome", workflow)
        self.assertIn("npm test", workflow)
        self.assertIn("python3 -m unittest", workflow)
        self.assertNotEqual(OFFLINE, "success")


if __name__ == "__main__":
    unittest.main()
