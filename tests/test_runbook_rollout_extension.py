"""Contrato estructural de actualización y rollback Chrome/Safari (#262)."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNBOOK = ROOT / "docs" / "runbook-rollout-extension.md"
RELEASE = ROOT / ".github" / "workflows" / "release.yml"
GATES = {f"G-{n:02d}" for n in range(1, 13)}
MANDATORY = {"G-01", "G-02", "G-03", "G-06", "G-07", "G-08",
             "G-09", "G-10", "G-11", "G-12"}
AUTHORIZED = {"G-04", "G-05"}


def gates_from_document(source: str):
    header = "| ID | Área | Evidencia y acción exigida | Tipo | Rechazo |"
    separator = "| --- | --- | --- | --- | --- |"
    if source.count(header) != 1 or source.count(separator) != 1:
        raise ValueError("Tabla de gates ausente o ambigua")
    table = source.split(header, 1)[1].split(separator, 1)[1]
    table = table.strip().split("\n\n", 1)[0]
    result = {}
    for line in table.splitlines():
        if not line.startswith("| ") or not line.endswith(" |"):
            raise ValueError("Fila malformada")
        cells = tuple(x.strip() for x in line[1:-1].split("|"))
        if len(cells) != 5 or cells[0] in result:
            raise ValueError("Gate duplicado o columnas inválidas")
        result[cells[0]] = cells
    return result


def can_declare_release(evidence: dict, gates: dict):
    """Veredicto local sobre estados explícitos, NO verificación de proveedor."""
    if set(gates) != GATES:
        return False
    if any(gates[g][3] != "OBLIGATORIO" for g in MANDATORY):
        return False
    if any(gates[g][3] != "DEL_DUEÑO" for g in AUTHORIZED):
        return False
    allowed = MANDATORY | AUTHORIZED | {
        "tag", "sha", "chrome_tag", "chrome_sha", "safari_tag", "safari_sha",
        "safari_real", "safari_unsigned_build",
    }
    if set(evidence) != allowed:
        return False
    tag, sha = evidence["tag"], evidence["sha"]
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        return False
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        return False
    if any(evidence[field] != tag for field in ("chrome_tag", "safari_tag")):
        return False
    if any(evidence[field] != sha for field in ("chrome_sha", "safari_sha")):
        return False
    if evidence["safari_real"] != "success":
        return False
    return all(evidence[g] == "success" for g in MANDATORY | AUTHORIZED)


class RunbookRolloutExtensionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = RUNBOOK.read_text(encoding="utf-8")
        cls.gates = gates_from_document(cls.text)

    def _valid(self):
        return {
            **{gate: "success" for gate in GATES},
            "tag": "v1.7.38", "sha": "a" * 40,
            "chrome_tag": "v1.7.38", "chrome_sha": "a" * 40,
            "safari_tag": "v1.7.38", "safari_sha": "a" * 40,
            "safari_real": "success", "safari_unsigned_build": "success",
        }

    def test_release_exige_evidencia_chrome_y_safari(self):
        self.assertEqual(set(self.gates), GATES)
        self.assertEqual(
            {gate for gate, cells in self.gates.items()
             if cells[3] == "OBLIGATORIO"}, MANDATORY)
        self.assertEqual(
            {gate for gate, cells in self.gates.items()
             if cells[3] == "DEL_DUEÑO"}, AUTHORIZED)
        for needed in ("manifest.json", "package-lock.json", "SHA-256",
                       "firma/distribución Chrome/Safari",
                       "Chrome Web Store", "Xcode",
                       "SMOKE_SAFARI_REAL", "tag", "rollback",
                       "preflight=success", "publish=success",
                       "chrome_smoke=success", "safari_smoke=success"):
            with self.subTest(needle=needed):
                self.assertIn(needed, self.text)
        release = RELEASE.read_text(encoding="utf-8")
        self.assertIn("Real unsigned Safari/Xcode build smoke", release)
        self.assertIn("CODE_SIGNING_ALLOWED=NO", self.text)
        self.assertTrue(can_declare_release(self._valid(), self.gates))
        for field in ("chrome_sha", "safari_sha", "chrome_tag", "safari_tag"):
            bad = self._valid()
            bad[field] = "b" * 40
            self.assertFalse(can_declare_release(bad, self.gates), field)

    def test_rollback_conserva_estado_y_artefactos(self):
        for clause in ("artefacto anterior instalable", "No desactivar seguridad",
                       "no sobrescribir", "no borrar assets",
                       "chrome.storage", "post-rollback", "SHA-256",
                       "sin modificar el estado real", "NO_GO"):
            with self.subTest(clause=clause):
                self.assertIn(clause.lower(), self.text.lower())
        self.assertIn("G-11", self.gates)
        self.assertIn("G-12", self.gates)
        for gate in ("G-10", "G-11", "G-12"):
            bad = self._valid()
            bad[gate] = "UNKNOWN"
            self.assertFalse(can_declare_release(bad, self.gates))

    def test_safari_real_fail_closed(self):
        self.assertIn("SMOKE_SAFARI_REAL", self.gates["G-07"][2])
        self.assertIn("NO_GO", self.gates["G-07"][4])
        for status in ("skipped", "in_progress", "failure", "UNKNOWN", "", None):
            with self.subTest(status=status):
                bad = self._valid()
                bad["safari_real"] = status
                bad["safari_unsigned_build"] = "success"
                self.assertFalse(can_declare_release(bad, self.gates))
        for field in ("G-07", "G-04", "G-05", "G-06"):
            bad = self._valid()
            bad[field] = "UNKNOWN"
            self.assertFalse(can_declare_release(bad, self.gates))
        bad = self._valid()
        del bad["safari_real"]
        self.assertFalse(can_declare_release(bad, self.gates))
        removed_gate = dict(self.gates)
        del removed_gate["G-07"]
        self.assertFalse(can_declare_release(self._valid(), removed_gate))
        self.assertRegex(self.text, r"#122")
        self.assertIn("no smoke Safari real", self.text)


if __name__ == "__main__":
    unittest.main()
