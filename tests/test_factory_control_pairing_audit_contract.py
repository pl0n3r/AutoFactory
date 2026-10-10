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
        self.assertLess(explicit_revoke.index("if (intentRecorded !== true)"),
                        explicit_revoke.index("const result = checkedPairingResult(await pairing.revoke(input))"))


if __name__ == "__main__":
    unittest.main()
