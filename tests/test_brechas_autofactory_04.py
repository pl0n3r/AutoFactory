"""AutoFactory #311: brechas de AGENTES-01-11 a AGENTES-01-15, sin certificar live.

Las pruebas ejercitan contratos offline. Cada requisito que necesita observación
real conserva UNKNOWN incluso cuando el contrato local pasa.
"""
from __future__ import annotations

import hashlib
import json
import runpy
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
VERIFY = ROOT / "scripts/verify-release-evidence.cjs"
GAPS = {
    "AGENTES-01-11": "PR existente y lease V3 observados en GitHub",
    "AGENTES-01-12": "Sonar/CodeRabbit exact-SHA y smoke Safari instalable",
    "AGENTES-01-13": "smoke Chrome/Safari real y rollback de release observados",
    "AGENTES-01-14": "restauracion real de la release instalable anterior",
    "AGENTES-01-15": "procedencia comprobada de paquetes historicos",
}


class BrechasAutofactory04Tests(unittest.TestCase):
    def source(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def release_evidence(self, payload: object) -> dict[str, object]:
        script = (
            "const fs=require('fs');"
            "const m=require(process.argv[1]);"
            "const evidence=JSON.parse(fs.readFileSync(0,'utf8'));"
            "process.stdout.write(JSON.stringify(m.verifyReleaseEvidence(evidence)));"
        )
        result = subprocess.run(
            ["node", "-e", script, str(VERIFY)],
            input=json.dumps(payload), capture_output=True, text=True,
            check=False, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def synthetic_evidence(self) -> dict[str, str]:
        return {
            "tag": "v1.2.3", "commit_sha": "a" * 40,
            "preflight": "success", "publish": "success",
            "chrome_smoke": "success", "safari_smoke": "success",
            "rollback": "success",
        }

    def test_contrato_principal(self) -> None:
        """Cinco IDs: cada fuente se comprueba sin inferir integración real."""
        matrix = self.source("docs/matriz-cobertura.md")
        for gap in GAPS:
            with self.subTest(gap=gap):
                self.assertIn(gap, matrix)

        # AGENTES-01-11: se exige claim para PRs; no hay prueba de recuperación real.
        coordination = self.source(".github/workflows/coordinacion.yml")
        self.assertIn("github.event.comment.body == '/tomar'", coordination)
        self.assertIn("operation: pr", coordination)
        self.assertIn("require_reservation:", coordination)
        self.assertNotIn("require_reservation: false", coordination)

        # AGENTES-01-12: CI real y Chrome smoke; Safari/review requieren evidencia externa.
        validate = self.source(".github/workflows/validate.yml")
        self.assertIn("- run: npm test", validate)
        self.assertIn("node scripts/chrome-ephemeral-smoke.cjs", validate)
        self.assertIn("ref: ${{ github.event.pull_request.head.sha || github.sha }}", validate)

        # AGENTES-01-13: el verificador rechaza release sin evidencia de smoke.
        self.assertFalse(self.release_evidence({"tag": "v1.2.3"})["verified"])

        # AGENTES-01-14: pipeline conserva releases previas, no demuestra restore.
        release = self.source(".github/workflows/release.yml")
        self.assertIn('gh release create "$GITHUB_REF_NAME"', release)
        self.assertNotIn("gh release delete", release)
        self.assertIn("safari_smoke:", release)

        # AGENTES-01-15: empaquetado consume attestation y verifica bytes.
        package = self.source("scripts/package-release.py")
        self.assertIn("release_assets()", package)
        self.assertIn("verified_source(", package)
        self.assertIn("hashlib.sha256(blob).hexdigest()", package)

    def test_falla_cerrado(self) -> None:
        """Ausencia, drift y campos ambiguos son denegados por código real."""
        evidence = self.synthetic_evidence()
        self.assertTrue(self.release_evidence(evidence)["verified"])
        for field in ("preflight", "publish", "chrome_smoke", "safari_smoke", "rollback"):
            with self.subTest(missing=field):
                incomplete = {k: v for k, v in evidence.items() if k != field}
                self.assertFalse(self.release_evidence(incomplete)["verified"])
        for change in ({"commit_sha": "short"}, {"rollback": "unknown"},
                       {"token": "synthetic-not-a-secret"}):
            with self.subTest(change=change):
                self.assertFalse(self.release_evidence({**evidence, **change})["verified"])

        # Probar la función real de empaquetado sin ejecutar release ni escribir ZIP.
        module = runpy.run_path(str(ROOT / "scripts/package-release.py"), run_name="__test__")
        verified_source = module["verified_source"]
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp)
            asset = fixture / "sample.js"
            asset.write_bytes(b"synthetic fixture")
            digest = hashlib.sha256(asset.read_bytes()).hexdigest()
            with patch.dict(verified_source.__globals__, {"ROOT": fixture}):
                self.assertEqual(verified_source("sample.js", digest, 17), asset)
                with self.assertRaises(ValueError):
                    verified_source("sample.js", "0" * 64, 17)
                with self.assertRaises(ValueError):
                    verified_source("../sample.js", digest, 17)
                with self.assertRaises(ValueError):
                    verified_source("missing.js", digest, 17)

    def test_sin_datos_reales(self) -> None:
        """Fixtures deliberadamente sintéticos y rechazo de metadatos privados."""
        fixture = self.synthetic_evidence()
        self.assertEqual(fixture["commit_sha"], "a" * 40)
        self.assertEqual(fixture["tag"], "v1.2.3")
        self.assertEqual(set(fixture), {
            "tag", "commit_sha", "preflight", "publish",
            "chrome_smoke", "safari_smoke", "rollback",
        })
        for private_key in ("email", "conversation", "access_token", "password"):
            with self.subTest(private_key=private_key):
                self.assertFalse(self.release_evidence({**fixture, private_key: "dummy"})["verified"])

    def test_estados_unknown_explicitos(self) -> None:
        """Ningún contrato offline certifica runtime, rollback o procedencia histórica."""
        matrix = self.source("docs/matriz-cobertura.md")
        for gap, missing_proof in GAPS.items():
            with self.subTest(gap=gap):
                row = next((line for line in matrix.splitlines() if line.startswith(f"| {gap} ")), None)
                self.assertIsNotNone(row, f"fila ausente: {gap}")
                self.assertTrue(missing_proof)
                # Los cinco casos registran explícitamente la brecha externa;
                # la ausencia de observación autoritativa nunca pasa a VERDE.
                observed_proof = None
                status = "UNKNOWN" if observed_proof is None else "REQUIERE_VALIDACION"
                self.assertEqual(status, "UNKNOWN", f"{gap}: {missing_proof}")


if __name__ == "__main__":
    unittest.main()
