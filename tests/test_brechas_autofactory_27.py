#!/usr/bin/env python3
"""AutoFactory #334: cinco contratos de seguridad README, solo evidencia offline.

Los escenarios Node usan fakes de políticas y autorización. Un PASS local no
certifica instalación, publicación, privacidad legal ni bridge operativo.
"""
from __future__ import annotations

import ast
import json
import os
from functools import lru_cache
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "UNKNOWN"
LOCAL = "CONTRATO_LOCAL"
GAPS = {
    "README-08-03": "No eludir rate limits ni controles de plataforma",
    "README-08-04": "Toda modificación de tratamientos personales exige actualizar \x60datos.yml\x60 y aplicar puertas legales",
    "README-08-05": "Mantener release anterior instalable como rollback",
    "README-08-06": "Preservar paridad Chrome/Safari",
    "README-08-07": "El puente con ControlBot permanece sin tráfico real, pairing o tratamientos reales hasta D-061",
}
MATRIX = "docs/matriz-cobertura.md"
CONTRAST = "docs/contraste-af_readme.md"
README = "README.md"
CHROME = "manifest.json"
SAFARI = "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json"
BUDGET = "test-account-budget.cjs"
ACTIVATION = "test-factory-control-activation.cjs"
MARKERS = {
    BUDGET: "account-budget: ok",
    ACTIVATION: "factory-control activation preflight: ok",
}
SOURCES = (
    MATRIX, CONTRAST, README, "AGENTES.md", "decisiones.yml", "datos.yml",
    CHROME, SAFARI, BUDGET, ACTIVATION, "factory-control-activation.js",
    "tests/test_release_artifact_attestation.py",
    "tests/test_safari_project_bundle.py",
    "tests/test_permisos_extension_auditoria.py", ".github/workflows/release.yml",
)


def read_sources() -> dict[str, str]:
    """Read only the checkout under test; never fetch remote data."""
    return {p: (ROOT / p).read_text(encoding="utf-8") for p in SOURCES}


def rows(source: str, prefix: str, separator: str) -> dict[str, tuple[str, ...]]:
    """Reject absent, duplicate and partial rows instead of guessing coverage."""
    found = {}
    for identifier in GAPS:
        matches = [line for line in source.splitlines()
                   if line.startswith("| " + identifier + separator)]
        if len(matches) != 1:
            raise ValueError("UNKNOWN: missing or ambiguous " + identifier)
        cells = tuple(c.strip() for c in matches[0].strip("|").split("|"))
        if (len(cells) != 5 or cells[2 if prefix == "matrix" else 3] != "NO_VERIFICABLE"
                or not cells[0].startswith(identifier)
                or "Falta" not in cells[3 if prefix == "matrix" else 4]):
            raise ValueError("UNKNOWN: malformed evidence " + identifier)
        if prefix == "matrix" and ("README.md" not in cells[0]
                                    or "Estado operativo: UNKNOWN" not in cells[3]
                                    or "Contraste #292" not in cells[3]):
            raise ValueError("UNKNOWN: unverified matrix " + identifier)
        found[identifier] = cells
    return found


def readme_section(source: str) -> str:
    lines = source.splitlines()
    found = [i for i, line in enumerate(lines) if line == "## Calidad y seguridad"]
    if len(found) != 1:
        return ""
    end = next((i for i in range(found[0] + 1, len(lines))
                if lines[i].startswith("## ")), len(lines))
    return "\n".join(lines[found[0] + 1:end])


def active_decision(source: str, identifier: str) -> bool:
    try:
        data = json.loads(source)
        entries = [x for x in data["decisions"] if x.get("id") == identifier]
        return (len(entries) == 1 and entries[0].get("status") == "active"
                and "puente" in entries[0].get("text", "").lower())
    except (ValueError, TypeError, KeyError, AttributeError):
        return False


def same_manifests(source: dict[str, str]) -> bool:
    try:
        a, b = json.loads(source[CHROME]), json.loads(source[SAFARI])
        return (type(a) is dict and type(b) is dict and a == b
                and a.get("manifest_version") == 3
                and a.get("host_permissions") == ["https://chatgpt.com/*"]
                and a.get("optional_host_permissions") == [
                    "http://127.0.0.1:8777/*", "http://*/*"]
                and len(a.get("content_scripts", [])) == 1)
    except (ValueError, TypeError, KeyError):
        return False


def classify(identifier: str, source: dict[str, str], node: dict[str, str]) -> str:
    """Positive = bounded local evidence; no source can elevate an operational claim."""
    if identifier not in GAPS or not all(source.get(p) for p in SOURCES):
        return UNKNOWN
    try:
        matrix = rows(source[MATRIX], "matrix", " ·")
        contrast = rows(source[CONTRAST], "contrast", " |")
    except ValueError:
        return UNKNOWN
    if (GAPS[identifier].replace("\x60", "") not in matrix[identifier][1]
            or GAPS[identifier].replace("\x60", "") not in contrast[identifier][1]
            or "Falta prueba negativa transversal" not in matrix[identifier][3]
            or "Falta prueba negativa transversal" not in contrast[identifier][4]):
        return UNKNOWN
    section = readme_section(source[README])
    if not section or "- " + GAPS[identifier] + "." not in section:
        return UNKNOWN
    agents = source["AGENTES.md"]
    if not all(t in agents for t in ("D-061", "Safari", "datos.yml")):
        return UNKNOWN
    if identifier == "README-08-03":
        budget = source[BUDGET]
        if (node.get(BUDGET) != MARKERS[BUDGET]
                or "Factory limit=0 must be an authoritative pause" not in budget
                or "STALE Factory evidence must fall back" not in budget
                or "assert.throws(" not in budget):
            return UNKNOWN
    elif identifier == "README-08-04":
        try:
            data = json.loads(source["datos.yml"])
        except (ValueError, TypeError):
            return UNKNOWN
        if (not active_decision(source["decisiones.yml"], "D-061")
                or data.get("phase") != "construccion"
                or type(data.get("treatments")) is not list
                or not data["treatments"]
                or "datos.yml" not in section):
            return UNKNOWN
    elif identifier == "README-08-05":
        audit = source["tests/test_release_artifact_attestation.py"]
        workflow = source[".github/workflows/release.yml"]
        if ("release anterior instalable" not in agents
                or "def test_mismatch_symlink_or_undeclared_asset_fails_closed" not in audit
                or "Chrome/Safari asset mismatch" not in audit
                or "gh release create" not in workflow
                or "chrome_smoke:" not in workflow or "safari_smoke:" not in workflow
                or "test_extension_copies_every_synced_resource" not in source[
                    "tests/test_safari_project_bundle.py"]):
            return UNKNOWN
    elif identifier == "README-08-06":
        audit = source["tests/test_permisos_extension_auditoria.py"]
        if (not same_manifests(source)
                or "test_exact_permission_matrix_and_mirrors" not in audit
                or "permiso-obligatorio-wildcard" not in audit
                or "host-opcional-extra" not in audit):
            return UNKNOWN
    elif identifier == "README-08-07":
        program, tests = source["factory-control-activation.js"], source[ACTIVATION]
        if (node.get(ACTIVATION) != MARKERS[ACTIVATION]
                or not active_decision(source["decisiones.yml"], "D-061")
                or any(t not in tests for t in ("consent_denied", "legal_blocked", "unpaired"))
                or any(t not in program for t in (
                    "loadVerifiedPairing", "loadVerifiedHeartbeatConsent", "loadVerifiedLegalGate"))):
            return UNKNOWN
    return LOCAL


@lru_cache(maxsize=2)
def run_node(suite: str) -> str:
    """Run checked-in synthetic Node assertion suites with an isolated environment."""
    if suite not in MARKERS:
        return UNKNOWN
    executable = shutil.which("node")
    if executable is None or not (ROOT / suite).is_file():
        return UNKNOWN
    env = {"PATH": os.pathsep.join((os.path.dirname(executable), "/usr/bin", "/bin")),
           "CI": "true"}
    try:
        done = subprocess.run([executable, str(ROOT / suite)], cwd=ROOT,
                              env=env, capture_output=True, text=True,
                              timeout=35, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return UNKNOWN
    return MARKERS[suite] if done.returncode == 0 and done.stdout.strip() == MARKERS[suite] else UNKNOWN


def operational(_id: object, _evidence: object = None) -> str:
    """No local assertion or green CI certifies consent, installation or deployment."""
    return UNKNOWN


class BrechasAutofactory27Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: map all five rows to distinct, runnable/sourced negative contracts."""
        source = read_sources()
        self.assertEqual(set(rows(source[MATRIX], "matrix", " ·")), set(GAPS))
        self.assertEqual(set(rows(source[CONTRAST], "contrast", " |")), set(GAPS))
        node = {p: run_node(p) for p in MARKERS}
        self.assertEqual(node, MARKERS)
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(classify(identifier, source, node), LOCAL)
                self.assertEqual(operational(identifier, node), UNKNOWN)

    def test_falla_cerrado(self) -> None:
        """AC-02: missing/duplicate rows, counterfeit success and mutated evidence fail."""
        source = read_sources()
        for path, prefix, sep in ((MATRIX, "matrix", " ·"),
                                  (CONTRAST, "contrast", " |")):
            for identifier in GAPS:
                row = next(s for s in source[path].splitlines()
                           if s.startswith("| " + identifier + sep))
                for invalid in (source[path].replace(row, "", 1),
                                source[path] + "\n" + row,
                                source[path].replace(row, row.replace(
                                    "NO_VERIFICABLE", "CUBIERTO"), 1)):
                    with self.subTest(path=path, identifier=identifier):
                        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                            rows(invalid, prefix, sep)
        changes = {
            "README-08-03": (BUDGET, "Factory limit=0 must be an authoritative pause", "no pause"),
            "README-08-04": ("decisiones.yml", '"status": "active"', '"status": "inactive"'),
            "README-08-05": ("tests/test_release_artifact_attestation.py",
                             "test_mismatch_symlink_or_undeclared_asset_fails_closed", "removed_regression"),
            "README-08-06": (SAFARI, '"manifest_version": 3', '"manifest_version": 2'),
            "README-08-07": (ACTIVATION, "legal_blocked", "permission_bypassed"),
        }
        for identifier, (path, old, new) in changes.items():
            broken = dict(source)
            self.assertIn(old, broken[path])
            broken[path] = broken[path].replace(old, new)
            with self.subTest(identifier=identifier):
                self.assertEqual(classify(identifier, broken, MARKERS), UNKNOWN)
        for identifier in GAPS:
            self.assertEqual(classify(identifier, {}, MARKERS), UNKNOWN)
            self.assertEqual(classify(identifier, source, {}),
                             UNKNOWN if identifier in ("README-08-03", "README-08-07") else LOCAL)

    def test_sin_datos_reales(self) -> None:
        """AC-03: only checked-in fixtures, no network, credentials or user data."""
        self.assertEqual(run_node(BUDGET), MARKERS[BUDGET])
        self.assertEqual(run_node(ACTIVATION), MARKERS[ACTIVATION])
        src = Path(__file__).read_text(encoding="utf-8")
        self.assertIn("env=env, capture_output=True", src)
        tree = ast.parse(src)
        imports = {a.name.split(".")[0] for node in ast.walk(tree)
                   if isinstance(node, ast.Import) for a in node.names}
        imports |= {node.module.split(".")[0] for node in ast.walk(tree)
                    if isinstance(node, ast.ImportFrom) and node.module}
        self.assertFalse(imports & {"requests", "urllib", "socket", "http", "httpx"})
        self.assertNotIn("os.environ" + ".copy()", src)
        self.assertNotIn("Authorization:" + " Bearer ", src)
        self.assertEqual(operational("README-08-04", {"personal_data": False}), UNKNOWN)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: every operational claim remains UNKNOWN even if tests pass."""
        source = read_sources()
        node = {p: run_node(p) for p in MARKERS}
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(classify(identifier, source, node), LOCAL)
                for fake in (None, {}, True, {"ci": "success"},
                             {"node": node, "synthetic": True},
                             {"installed": True, "rollback": "claimed"},
                             {"paired": True, "legal": True},
                             {"chrome": "ready", "safari": "ready"}):
                    self.assertEqual(operational(identifier, fake), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
