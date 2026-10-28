"""AutoFactory #315: contratos sintéticos D-059..D-062 y CI de seguridad.

Evidencia de código local no equivale a Hostinger, instalación real, ControlBot
conectado, consentimiento, backups, protección de rama ni go-live.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
UNKNOWN = "UNKNOWN"

# ID: decisión activa o None, fuente de contraste, prueba previa, contraste.
GAPS = {
    "DEC-D-059": ("D-059", "decisiones.yml",
                  "tests/test_ci_salida_quality.py", "#291"),
    "DEC-D-060": ("D-060", "docs/RELEASE-EVIDENCE.md",
                  "tests/test_release_artifact_attestation.py", "#291"),
    "DEC-D-061": ("D-061", "factory-control-pairing.js",
                  "tests/test_factory_control_pairing_public_result.py", "#291"),
    "DEC-D-062": ("D-062", "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json",
                  "tests/test_safari_project_bundle.py", "#291"),
    "DOC-CI-EXTENSION-SECURITY-01": (
        None, ".github/workflows/seguridad.yml",
        "tests/test_security_workflow_contract.py", "#290",
    ),
}


def extract_rows(document: str) -> dict[str, tuple[str, ...]]:
    """Exige las cinco filas no ambiguas, detectando duplicados con sangría."""
    if not isinstance(document, str):
        raise ValueError("matriz inválida")
    found: dict[str, tuple[str, ...]] = {}
    for raw in document.splitlines():
        line = raw.lstrip()
        if not line.startswith("| "):
            continue
        first = line[2:].split("|", 1)[0].strip()
        key = first.split(" · ", 1)[0]
        if key not in GAPS:
            continue
        parts = tuple(piece.strip() for piece in line.strip().strip("|").split("|"))
        if (len(parts) != 5 or key in found or
                not parts[0].startswith(key + " · ") or not all(parts)):
            raise ValueError("fila ambigua o incompleta: " + key)
        found[key] = parts[1:]
    if set(found) != set(GAPS):
        raise ValueError("faltan filas obligatorias")
    return found


def operational_state(row: object, *, observed_runtime: object = None) -> str:
    """La matriz y los fixtures nunca certifican un sistema operativo real."""
    # Ninguna de estas pruebas observa Hostinger, consentimientos,
    # instalaciones, smoke del navegador ni permisos GitHub en vivo.
    return UNKNOWN


def run_node(script: str) -> dict:
    """Ejecuta módulos locales sin red, con un límite de tiempo estricto."""
    result = subprocess.run(
        ["node", "-e", script], cwd=ROOT, capture_output=True,
        text=True, check=False, timeout=15,
    )
    if result.returncode:
        raise AssertionError("falló un contrato Node offline")
    return json.loads(result.stdout)


def release_contract() -> dict:
    """Ejercita el verificador auténtico sin publicar ninguna release."""
    return run_node(r"""
const {verifyReleaseEvidence, REQUIRED_CHECKS} =
  require('./scripts/verify-release-evidence.cjs');
const e = {tag:'v1.2.3',commit_sha:'a'.repeat(40),
  preflight:'success',publish:'success',chrome_smoke:'success',
  safari_smoke:'success',rollback:'success'};
const missing = {...e};
delete missing.safari_smoke;
process.stdout.write(JSON.stringify({
  count:REQUIRED_CHECKS.length,
  synthetic:verifyReleaseEvidence(e).verified,
  missing:verifyReleaseEvidence(missing).verified,
  ambiguous:verifyReleaseEvidence({...e, extra:'local'}).verified
}));
""")


def pairing_contract() -> dict:
    """Entradas inválidas nunca invocan los adaptadores de pairing."""
    return run_node(r"""
const {createPairingContract} = require('./factory-control-pairing.js');
let calls = 0;
const forbidden = async () => {calls++;throw new Error('offline');};
const pairing = createPairingContract({
  loadVerifiedChallenge:forbidden,consumeVerifiedChallenge:forbidden,
  issueOpaqueCredential:forbidden,revokeOpaqueCredential:forbidden,
  now:() => 1000
});
Promise.all([pairing.pair({}),pairing.revoke({})]).then(([pair,revoke])=>{
  process.stdout.write(JSON.stringify({pair,revoke,calls}));
}).catch(() => process.exit(2));
""")


class BrechasAutofactory08Tests(unittest.TestCase):
    """Los cuatro criterios de #315 se comprueban con ejemplos sintéticos."""

    @classmethod
    def setUpClass(cls) -> None:
        """Consulta solo fuentes versionadas, sin APIs externas."""
        cls.matrix_source = MATRIX.read_text(encoding="utf-8")
        cls.rows = extract_rows(cls.matrix_source)
        raw = json.loads((ROOT / "decisiones.yml").read_text(encoding="utf-8"))
        cls.decisions = {d["id"]: d for d in raw["decisions"]}

    def test_contrato_principal(self) -> None:
        """AC-01: cinco filas más contratos ejecutables de release y pairing."""
        self.assertEqual(set(self.rows), set(GAPS))
        for key, (decision_id, source, prior, reference) in GAPS.items():
            with self.subTest(row=key):
                requirement, state, evidence, issue = self.rows[key]
                self.assertEqual("NO_VERIFICABLE", state)
                self.assertIn("Contraste " + reference, evidence)
                self.assertIn("UNKNOWN", evidence)
                self.assertIn(chr(96) + source + chr(96), evidence)
                self.assertIn(chr(96) + prior + chr(96), evidence)
                self.assertTrue((ROOT / source).is_file(), source)
                self.assertTrue((ROOT / prior).is_file(), prior)
                self.assertTrue(issue.startswith("[#"))
                if decision_id is not None:
                    decision = self.decisions[decision_id]
                    self.assertEqual("active", decision["status"])
                    self.assertIn(decision["text"], requirement)
                else:
                    self.assertIn("CI de AutoFactory", requirement)
                self.assertEqual(UNKNOWN, operational_state(self.rows[key]))

        # D-059: decisión explícita no da capacidad de escritura o borrado.
        hostinger = self.decisions["D-059"]["text"]
        for gate in ("backup previo", "autorización explícita",
                     "ningún agente compra"):
            self.assertIn(gate, hostinger)

        # D-060: evidencia sintética completa puede validar el verificador
        # local, pero NO una instalación real en Chrome ni Safari.
        release = release_contract()
        self.assertEqual(5, release["count"])
        self.assertIs(release["synthetic"], True)
        self.assertIs(release["missing"], False)
        self.assertIs(release["ambiguous"], False)

        # D-061: inputs inválidos, cero tráfico y resultado público saneado.
        pairing = pairing_contract()
        self.assertEqual(0, pairing["calls"])
        for action in ("pair", "revoke"):
            self.assertEqual({"ok": False, "code": "invalid"}, pairing[action])

        # D-062: paridad de fuentes manifest, no smoke del navegador instalado.
        chrome = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        safari = json.loads((ROOT / GAPS["DEC-D-062"][1]).read_text(encoding="utf-8"))
        self.assertEqual(chrome, safari)
        self.assertEqual(3, chrome["manifest_version"])
        self.assertEqual(["https://chatgpt.com/*"], chrome["host_permissions"])

        # DOC-CI: política OWNER y Factory v1, sin disparar workflows.
        policy = (ROOT / GAPS["DOC-CI-EXTENSION-SECURITY-01"][1]).read_text(
            encoding="utf-8"
        )
        self.assertIn("github.event.comment.author_association == 'OWNER'", policy)
        self.assertIn("cancel-in-progress: false", policy)
        self.assertEqual(2, policy.count("repository: pl0n3r/factory"))
        self.assertNotIn("repository: pl0n3r/AutoFactory", policy)

    def test_falla_cerrado(self) -> None:
        """AC-02: datos ausentes o ambiguos producen rechazo, nunca verde."""
        lines = self.matrix_source.splitlines()
        for key in GAPS:
            row = next(x for x in lines if x.startswith("| " + key + " · "))
            with self.subTest(row=key):
                for mutation in (
                    self.matrix_source.replace(row, ""),
                    self.matrix_source + "\n " + row,
                    self.matrix_source.replace(row, "| " + key + " · truncada |"),
                ):
                    with self.assertRaises(ValueError):
                        extract_rows(mutation)
                self.assertEqual(UNKNOWN, operational_state(None))
        for fixture in ({}, {"status": "success"}, {"verified": True}):
            self.assertEqual(UNKNOWN, operational_state(fixture, observed_runtime=True))
        self.assertFalse(release_contract()["missing"])
        self.assertFalse(release_contract()["ambiguous"])
        self.assertEqual(0, pairing_contract()["calls"])

    def test_sin_datos_reales(self) -> None:
        """AC-03: fixtures ficticios y lectura exclusiva del checkout."""
        example = {
            "tag": "v1.2.3", "commit_sha": "a" * 40,
            "safari_smoke": None, "backup": None, "consent": False,
        }
        serialized = json.dumps(example, sort_keys=True)
        self.assertNotIn("@", serialized)
        self.assertNotIn("http://", serialized)
        self.assertNotIn("https://", serialized)
        self.assertNotRegex(serialized, r"(?i)(?:bearer\s+|sk-[a-z0-9]+|password\s*[:=])")
        for _, source, prior, _ in GAPS.values():
            self.assertTrue((ROOT / source).is_file())
            self.assertTrue((ROOT / prior).is_file())
        self.assertEqual(UNKNOWN, operational_state(example))

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: no confundir contratos con CI exact-HEAD ni producción."""
        for key, (decision_id, _, _, _) in GAPS.items():
            with self.subTest(row=key):
                requirement, state, evidence, _ = self.rows[key]
                self.assertEqual("NO_VERIFICABLE", state)
                self.assertIn("Estado operativo: UNKNOWN", evidence)
                self.assertEqual(UNKNOWN, operational_state(self.rows[key]))
                if decision_id is not None:
                    self.assertIn(decision_id, requirement)
        self.assertTrue(release_contract()["synthetic"])
        for pretend in ("release-success", "pairing-success", "safari-installed"):
            self.assertEqual(UNKNOWN, operational_state(pretend))


if __name__ == "__main__":
    unittest.main()
