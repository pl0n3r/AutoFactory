"""Criterios AC-01..04 para pairing y auditoría local fake (sin red)."""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "factory-control-pairing.js"
NODE_TEST = ROOT / "test-factory-control-pairing.cjs"


def run_pairing_fake() -> str:
    """Ejecuta el contrato JavaScript real sin imprimir secretos de adapters."""
    result = subprocess.run(
        ["node", str(NODE_TEST)], cwd=ROOT,
        capture_output=True, text=True, check=False, timeout=30,
    )
    if result.returncode != 0:
        raise AssertionError("Falló el contrato de pairing offline (consultar CI)")
    return result.stdout


class FactoryControlPairingAuditContractTests(unittest.TestCase):
    def test_pairing_invalid_expired_and_replayed_fail_closed(self):
        output = run_pairing_fake()
        self.assertIn("factory-control pairing contract: ok", output)
        self.assertIn("pairing-audit AC-01: ok", output)
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("if (challenge.revoked)", source)
        self.assertIn("if (challenge.used)", source)
        self.assertIn("if (challenge.expiresAt <= nowMs)", source)

    def test_revocation_retains_sanitized_audit_after_credential_removal(self):
        self.assertIn("pairing-audit AC-02: ok", run_pairing_fake())
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("phase: 'attempt'", source)
        self.assertIn("phase: 'result'", source)
        self.assertIn("const removed = await credentialStore.remove", source)

    def test_credentials_codes_and_adapter_errors_never_leak(self):
        self.assertIn("pairing-audit AC-03: ok", run_pairing_fake())
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("return safeResult(false, 'failed');", source)
        self.assertNotIn("console.log(input", source)
        self.assertNotIn("console.error(_error", source)

    def test_audit_write_failure_blocks_revoke_without_claiming_success(self):
        self.assertIn("pairing-audit AC-04: ok", run_pairing_fake())
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("if (intentRecorded !== true)", source)
        self.assertIn("if (outcomeRecorded !== true)", source)
        persisted = source.split("function createPersistedPairingContract", 1)[1]
        explicit_revoke = persisted.split("    async function revoke(input) {", 1)[1]
        # The static contract checks the validated immutable snapshot,
        # rather than the former mutable caller-owned input object.
        self.assertIn("const request = snapshotInput(input,", explicit_revoke)
        self.assertLess(explicit_revoke.index("const request = snapshotInput(input,"),
                        explicit_revoke.index("if (intentRecorded !== true)"))
        self.assertLess(explicit_revoke.index("if (intentRecorded !== true)"),
                        explicit_revoke.index("const result = checkedPairingResult(await pairing.revoke(request))"))


    # Factory #154: Node scenarios execute the real JavaScript with synthetic
    # issuing/revoking adapters, not static mocks of the policy.
    def test_postissue_invalid_metadata_compensates_opaque_credential(self):
        output = run_pairing_fake()
        self.assertIn("pairing-postissue AC-01..04: ok", output)
        self.assertIn("compensatePostIssue", SOURCE.read_text(encoding="utf-8"))

    def test_postissue_clock_or_unverifiable_handle_fails_closed(self):
        output = run_pairing_fake()
        self.assertIn("pairing-postissue AC-01..04: ok", output)
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("Invalid post-issue clock", source)
        self.assertIn("outcome = 'unknown'", source)

    def test_compensation_audit_is_correlated_sanitized_and_bounded(self):
        output = run_pairing_fake()
        self.assertIn("pairing-postissue AC-01..04: ok", output)
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("internalPostIssueAudit", source)
        self.assertIn("event: 'pairing_compensation'", source)
        self.assertIn("phase, auditId", source)

    def test_existing_pairing_replay_persistence_and_revocation_regressions(self):
        output = run_pairing_fake()
        self.assertIn("pairing-audit AC-01: ok", output)
        self.assertIn("pairing-audit AC-04: ok", output)
        self.assertIn("factory-control pairing contract: ok", output)


if __name__ == "__main__":
    unittest.main()
