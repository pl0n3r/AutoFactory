"""AutoFactory #309: cobertura local de AGENTES-01-01..05, sin simular integración.

Las aserciones verifican contratos del repositorio. Un fixture sintético jamás
acredita que la extensión se instaló ni que hubo un smoke real de Safari.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAFARI = Path("safari/ChatGPT Autopilot Local Extension/Resources/manifest.json")
ROW_IDS = (
    "AGENTES-01-01", "AGENTES-01-02", "AGENTES-01-03",
    "AGENTES-01-04", "AGENTES-01-05",
)
UNKNOWN = "UNKNOWN"


def load_json(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def coverage_rows():
    """Leer la matriz original sin modificar estados ni aceptar filas duplicadas."""
    lines = (ROOT / "docs/matriz-cobertura.md").read_text(encoding="utf-8")
    result = {}
    for line in lines.splitlines():
        if not line.startswith("| AGENTES-01-0"):
            continue
        cells = tuple(value.strip() for value in line.strip().strip("|").split("|"))
        if len(cells) != 5:
            raise AssertionError(f"Fila AGENTES malformada: {line}")
        identifier = cells[0].split(" · ", 1)[0]
        if identifier in result:
            raise AssertionError(f"Fila AGENTES duplicada: {identifier}")
        result[identifier] = cells
    return result


def runtime_verdict(row_id, proof):
    """Los datos offline solo pueden proponer verificación externa, no certificarla."""
    if row_id not in ROW_IDS or not isinstance(proof, dict):
        return UNKNOWN
    sha = proof.get("head_sha")
    installed = proof.get("installed_sha")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        return UNKNOWN
    if installed != sha:
        return UNKNOWN
    if proof.get("chrome_smoke") is not True or proof.get("safari_smoke") is not True:
        return UNKNOWN
    if proof.get("provenance") != "observacion-externa-auditable":
        return UNKNOWN
    # La procedencia declarada en un dict no prueba autenticidad. Hace falta
    # validación externa del run/artefacto antes de cambiar la matriz.
    return "PENDIENTE_AUDITORIA"


class BrechasAutofactory02Tests(unittest.TestCase):
    def test_contrato_principal(self):
        rows = coverage_rows()
        for identifier in ROW_IDS:
            with self.subTest(row=identifier):
                self.assertIn(identifier, rows)
                self.assertEqual(rows[identifier][2], "NO_VERIFICABLE")
                self.assertIn("UNKNOWN", rows[identifier][3])
                self.assertIn("Capa local de la extensión", rows[identifier][1])

        # AGENTES-01-01: producto/extensión local, no servidor ni instalación real.
        chrome = load_json("manifest.json")
        safari = load_json(SAFARI)
        self.assertEqual(chrome["manifest_version"], 3)
        self.assertEqual(chrome["name"], "ChatGPT Autopilot Local")
        self.assertEqual(safari["name"], chrome["name"])
        self.assertEqual(safari["manifest_version"], chrome["manifest_version"])

        # AGENTES-01-02: contrato Node >=20 y contenedor Swift/Xcode presente.
        package = load_json("package.json")
        self.assertEqual(package["engines"]["node"], ">=20")
        self.assertTrue((ROOT / "safari/ChatGPT Autopilot Local.xcodeproj/project.pbxproj").is_file())

        # AGENTES-01-03: paridad de metadatos, NO de artefacto instalado.
        lock = load_json("package-lock.json")
        versions = (chrome["version"], safari["version"], package["version"],
                    lock["version"], lock["packages"][""]["version"])
        self.assertEqual(len(set(versions)), 1)
        self.assertRegex(versions[0], r"^\d+\.\d+\.\d+$")

        # AGENTES-01-04: versión solo por corte/tag, con release sujeta a main.
        release = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn('tags:', release)
        self.assertIn('"v[0-9]+.[0-9]+.[0-9]+"', release)
        self.assertIn('Verify tagged commit is current main', release)
        self.assertIn('git rev-parse refs/remotes/origin/main', release)

        # AGENTES-01-05: fuente de verdad documental y checkout de HEAD exacto.
        ci = (ROOT / ".github/workflows/validate.yml").read_text(encoding="utf-8")
        self.assertIn("github.event.pull_request.head.sha || github.sha", ci)
        self.assertIn("git rev-parse HEAD", ci)
        for relative in ("CHANGELOG.md", "decisiones.yml", "docs"):
            with self.subTest(source=relative):
                self.assertTrue((ROOT / relative).exists())
        self.assertIn("Fuente de verdad:", (ROOT / "AGENTES.md").read_text(encoding="utf-8"))

    def test_falla_cerrado(self):
        sha = "a" * 40
        good_shape = {
            "head_sha": sha, "installed_sha": sha, "chrome_smoke": True,
            "safari_smoke": True, "provenance": "observacion-externa-auditable",
        }
        for identifier in ROW_IDS:
            with self.subTest(row=identifier):
                for invalid in (None, {}, [], {**good_shape, "head_sha": "invalid"},
                                {**good_shape, "installed_sha": "b" * 40},
                                {**good_shape, "chrome_smoke": None},
                                {**good_shape, "safari_smoke": "success"},
                                {**good_shape, "provenance": "sintetica"}):
                    self.assertEqual(runtime_verdict(identifier, invalid), UNKNOWN)
                self.assertNotEqual(runtime_verdict(identifier, good_shape), "CUBIERTO")
        self.assertEqual(runtime_verdict("AGENTES-01-99", good_shape), UNKNOWN)

    def test_sin_datos_reales(self):
        # Fixture fabricado: no tráfico, secretos, perfiles ni contenido de chats.
        synthetic = {
            "head_sha": "a" * 40, "installed_sha": "b" * 40,
            "chrome_smoke": False, "safari_smoke": None,
            "provenance": "sintetica",
        }
        self.assertEqual(runtime_verdict("AGENTES-01-01", synthetic), UNKNOWN)
        self.assertEqual(set(synthetic), {
            "head_sha", "installed_sha", "chrome_smoke", "safari_smoke", "provenance",
        })
        self.assertNotRegex(json.dumps(synthetic), r"@|password|secret|token|conversation")

    def test_estados_unknown_explicitos(self):
        rows = coverage_rows()
        self.assertEqual(set(ROW_IDS), set(rows).intersection(ROW_IDS))
        for identifier in ROW_IDS:
            with self.subTest(row=identifier):
                evidence = rows[identifier][3]
                self.assertIn("Estado operativo: UNKNOWN", evidence)
                self.assertRegex(evidence.lower(), r"falta|no certifica|pendiente")
                self.assertEqual(runtime_verdict(identifier, {"head_sha": "a" * 40}), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
