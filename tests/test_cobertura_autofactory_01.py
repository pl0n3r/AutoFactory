#!/usr/bin/env python3
"""#391: pruebas de comportamiento real offline de AF1-AC-01..05.

Los contratos de pairing, heartbeat, executor, account-state y runtime se
ejercitan mediante Node y puertos sintéticos, sin tránsito remoto. También
se prueba la paridad de versiones AGENTES-01-03 y la verificación de assets
AGENTES-01-15. Las demás filas dependen de evidencia real (B) o son
declaraciones normativas (C); ninguna simulación autoriza go-live.
"""
from __future__ import annotations

from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

SYNTHETIC = {
    "AF1-AC-01": ("test-factory-control-pairing.cjs", "pairing-public AC-01..04: ok"),
    "AF1-AC-02": ("test-factory-control-heartbeat.cjs", "heartbeat-presence AC-01: ok"),
    "AF1-AC-03": ("test-factory-control-executor.cjs", "Factory Control executor: authorization, durable idempotency, effect isolation and safe ACKs pass"),
    "AF1-AC-04": ("test-factory-control-account-state.cjs", "account-state AC-01: ok"),
    "AF1-AC-05": ("test-factory-control-bridge-e2e-synthetic.cjs", "bridge-e2e AC-01: full fake chain + lost ACK replay: PASS"),
}
RELEASE_CHECKS = ("preflight", "publish", "chrome_smoke", "safari_smoke", "rollback")


def _node() -> tuple[str, dict[str, str]]:
    executable = shutil.which("node")
    if not executable:
        raise AssertionError("UNKNOWN: Node no disponible para verificar JS")
    safe_path = os.pathsep.join((str(Path(executable).parent), "/usr/local/bin", "/usr/bin", "/bin"))
    return executable, {"PATH": safe_path, "FACTORY_PAIRING_PYTHON_CHILD": "1"}


@lru_cache(maxsize=12)
def run_case(filename: str, mode: str = "") -> str:
    approved = {item[0] for item in SYNTHETIC.values()} | {"test-factory-control-runtime.cjs"}
    if filename not in approved:
        raise AssertionError("UNKNOWN: suite no autorizada")
    node, env = _node()
    result = subprocess.run(
        [node, str(ROOT / filename), *([mode] if mode else [])],
        cwd=ROOT, env=env, text=True, capture_output=True, timeout=120, check=False,
    )
    if result.returncode != 0:
        raise AssertionError(f"UNKNOWN: contrato Node {filename} falló ({result.returncode})")
    return result.stdout


def release_evidence(payload: object) -> dict:
    """Invoca verifyReleaseEvidence() real sobre un JSON completamente ficticio."""
    script = (
        "const fs=require('fs');"
        "const m=require(process.argv[1]);"
        "const data=JSON.parse(fs.readFileSync(0,'utf8'));"
        "process.stdout.write(JSON.stringify(m.verifyReleaseEvidence(data)));"
    )
    node, env = _node()
    result = subprocess.run(
        [node, "-e", script, str(ROOT / "scripts/verify-release-evidence.cjs")],
        input=json.dumps(payload), cwd=ROOT, env=env, text=True,
        capture_output=True, check=False, timeout=20,
    )
    if result.returncode != 0:
        raise AssertionError("UNKNOWN: verificador real de release no disponible")
    return json.loads(result.stdout)


def fake_release() -> dict[str, str]:
    return {"tag": "v1.2.3", "commit_sha": "a" * 40,
            **{name: "success" for name in RELEASE_CHECKS}}


class CoberturaAutofactory01Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AF1-AC-01..05 y AGENTES-01-03/15 llaman código real, no matriz."""
        self.assertEqual(len(SYNTHETIC), 5)
        for identifier, (suite, expected) in SYNTHETIC.items():
            with self.subTest(requirement=identifier):
                self.assertIn(expected, run_case(suite))
        # La cadena E2E es solo fake/offline, no conexión a ControlBot.
        self.assertIn("bridge-e2e AC-02: fail-closed, no real transport, rollback: PASS",
                      run_case(SYNTHETIC["AF1-AC-05"][0]))

        # AGENTES-01-03: comparar cuatro metadatos de producto reales.
        paths = ("manifest.json",
                 "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json",
                 "package.json", "package-lock.json")
        manifests = [json.loads((ROOT / name).read_text(encoding="utf-8")) for name in paths]
        versions = [value["version"] for value in manifests]
        self.assertEqual(1, len(set(versions)), "versiones Chrome/Safari/npm divergentes")
        self.assertEqual(versions[0], manifests[-1]["packages"][""]["version"])
        self.assertEqual(manifests[0], manifests[1])
        self.assertEqual(3, manifests[0]["manifest_version"])

        # AGENTES-01-15: verificar bytes con función de producción sin crear ZIP.
        module = runpy.run_path(str(ROOT / "scripts/package-release.py"), run_name="__contract__")
        verify = module["verified_source"]
        with tempfile.TemporaryDirectory(prefix="af391-") as tmp:
            data = b"synthetic offline asset"
            asset = Path(tmp) / "fixture.js"
            asset.write_bytes(data)
            with patch.dict(verify.__globals__, {"ROOT": Path(tmp)}):
                self.assertEqual(asset, verify("fixture.js", hashlib.sha256(data).hexdigest(), len(data)))
        self.assertTrue(release_evidence(fake_release())["verified"])

    def test_falla_cerrado(self) -> None:
        """Negativos reales: autorización, replay, señal stale y attestation."""
        negatives = (
            ("AF1-AC-01", "pairing-audit AC-01: ok"),
            ("AF1-AC-02", "heartbeat-presence AC-03: ok"),
            ("AF1-AC-03", "Factory Control audit AC-03: sanitized durable decisions"),
            ("AF1-AC-04", "account-state AC-03: ok"),
            ("AF1-AC-05", "bridge-e2e AC-02: fail-closed, no real transport, rollback: PASS"),
        )
        for identifier, marker in negatives:
            with self.subTest(requirement=identifier):
                self.assertIn(marker, run_case(SYNTHETIC[identifier][0]))
        self.assertIn("factory-control runtime lifecycle: ok",
                      run_case("test-factory-control-runtime.cjs", "failclosed"))

        good = fake_release()
        for missing in RELEASE_CHECKS:
            with self.subTest(missing=missing):
                self.assertFalse(release_evidence({key: val for key, val in good.items() if key != missing})["verified"])
        for change in ({"commit_sha": "short"}, {"safari_smoke": "unknown"},
                       {"email": "fixture"}, {"token": "fixture"}):
            with self.subTest(change=list(change)):
                self.assertFalse(release_evidence({**good, **change})["verified"])

        module = runpy.run_path(str(ROOT / "scripts/package-release.py"), run_name="__contract__")
        verify = module["verified_source"]
        with tempfile.TemporaryDirectory(prefix="af391-negative-") as tmp:
            path = Path(tmp) / "safe.js"
            path.write_bytes(b"synthetic")
            digest = hashlib.sha256(b"synthetic").hexdigest()
            with patch.dict(verify.__globals__, {"ROOT": Path(tmp)}):
                for name, sha, size in (("../safe.js", digest, 9),
                                        ("safe.js", "0" * 64, 9),
                                        ("safe.js", digest, 10),
                                        ("missing.js", digest, 9)):
                    with self.subTest(asset=name):
                        with self.assertRaises(ValueError):
                            verify(name, sha, size)

    def test_sin_datos_reales(self) -> None:
        """Entradas ficticias, entorno allowlisted, sin secretos ni conectividad."""
        evidence = fake_release()
        self.assertEqual(set(evidence), {"tag", "commit_sha", *RELEASE_CHECKS})
        self.assertEqual("a" * 40, evidence["commit_sha"])
        self.assertTrue(release_evidence(evidence)["verified"])
        for identifier, (suite, _) in SYNTHETIC.items():
            with self.subTest(requirement=identifier):
                stdout = run_case(suite).lower()
                for secret in ("private chat text", "private-token",
                               "secret@example.com", "credential-001",
                               "token=never-reflect"):
                    self.assertNotIn(secret, stdout)
        self.assertFalse(release_evidence({**evidence, "conversation": "fixture"})["verified"])


if __name__ == "__main__":
    unittest.main()
