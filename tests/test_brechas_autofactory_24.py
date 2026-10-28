#!/usr/bin/env python3
"""AutoFactory #331: contratos locales README-05-01..README-06-02.

Evidencia estrictamente sintética/offline. Ni los tests ni un CI verde acreditan
pairing, consentimiento, instalación Chrome/Safari o operación del puente.
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
LOCAL_CONTRACT = "CONTRATO_LOCAL"
NODE_MARKER = "factory-control activation preflight: ok"
GAPS = {
    "README-05-01": ("Arquitectura en 60 segundos", "FactoryRunner"),
    "README-05-02": ("Arquitectura en 60 segundos", "Chrome utiliza"),
    "README-05-03": ("Arquitectura en 60 segundos", "puente AutoFactory"),
    "README-06-01": ("Stack e infraestructura", "Safari/Xcode"),
    "README-06-02": ("Stack e infraestructura", "Node.js"),
}
SOURCES = (
    "docs/matriz-cobertura.md", "docs/contraste-af_readme.md", "README.md",
    "AGENTES.md", "decisiones.yml", "manifest.json",
    "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json",
    "safari/ChatGPT Autopilot Local.xcodeproj/project.pbxproj",
    "package.json", ".github/workflows/validate.yml",
    "factory-control-activation.js", "test-factory-control-activation.cjs",
)


def source_text() -> dict[str, str]:
    """Local repository sources only; no HTTP, credentials or live environment."""
    return {name: (ROOT / name).read_text(encoding="utf-8") for name in SOURCES}


def matrix_rows(text: str) -> dict[str, tuple[str, ...]]:
    """Missing, duplicated or malformed coverage rows fail closed."""
    result = {}
    for identifier in GAPS:
        lines = [s for s in text.splitlines() if s.startswith(f"| {identifier} ·")]
        if len(lines) != 1:
            raise ValueError(f"UNKNOWN: missing/duplicate {identifier}")
        cells = tuple(x.strip() for x in lines[0].strip("|").split("|"))
        if (len(cells) != 5 or cells[2] != "NO_VERIFICABLE"
                or not cells[0].startswith(identifier + " · README.md")
                or "Contraste #292" not in cells[3]
                or "Estado operativo: UNKNOWN" not in cells[3]):
            raise ValueError(f"UNKNOWN: invalid matrix {identifier}")
        result[identifier] = cells
    return result


def section(text: str, title: str) -> str:
    """Read a single Markdown heading without borrowing facts from other sections."""
    lines = text.splitlines()
    found = [i for i, line in enumerate(lines) if line.strip() == "## " + title]
    if len(found) != 1:
        return ""
    start = found[0] + 1
    end = next((j for j in range(start, len(lines)) if lines[j].startswith("## ")),
               len(lines))
    return "\n".join(lines[start:end])


def decision_active(text: str, identifier: str) -> bool:
    try:
        payload = json.loads(text)
        found = [item for item in payload["decisions"] if item.get("id") == identifier]
        return (len(found) == 1 and found[0].get("status") == "active"
                and "puente" in found[0].get("text", "").lower())
    except (ValueError, TypeError, KeyError, AttributeError):
        return False


def manifests_match(sources: dict[str, str]) -> bool:
    try:
        chrome = json.loads(sources["manifest.json"])
        safari = json.loads(sources[
            "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json"])
        required = ["https://chatgpt.com/*"]
        return (type(chrome) is dict and type(safari) is dict
                and chrome.get("manifest_version") == safari.get("manifest_version") == 3
                and chrome.get("host_permissions") == safari.get("host_permissions") == required
                and chrome.get("optional_host_permissions") == safari.get("optional_host_permissions")
                and chrome.get("content_scripts") == safari.get("content_scripts")
                and "http://*/*" in chrome.get("optional_host_permissions", [])
                and "PBXProject" in sources[
                    "safari/ChatGPT Autopilot Local.xcodeproj/project.pbxproj"])
    except (ValueError, TypeError, KeyError):
        return False


def contract(identifier: str, sources: dict[str, str], node_result: str) -> str:
    """Only classify reproducible local contracts, never real-world readiness."""
    if identifier not in GAPS or not all(sources.get(path) for path in SOURCES):
        return UNKNOWN
    try:
        row = matrix_rows(sources["docs/matriz-cobertura.md"])[identifier]
    except (KeyError, ValueError):
        return UNKNOWN
    title, statement = GAPS[identifier]
    readme = section(sources["README.md"], title)
    if not readme or statement.casefold() not in readme.casefold():
        return UNKNOWN
    contrast = sources["docs/contraste-af_readme.md"]
    report = [line for line in contrast.splitlines()
              if line.startswith("| " + identifier + " |")]
    if (len(report) != 1 or "NO_VERIFICABLE" not in report[0]
            or "Falta" not in report[0]
            or not statement.casefold() in row[1].casefold()):
        return UNKNOWN

    agents = sources["AGENTES.md"]
    if not decision_active(sources["decisiones.yml"], "D-061"):
        return UNKNOWN
    if identifier == "README-05-01":
        if not all(x in readme for x in (
                "FactoryRunner", "ControlBot", "governance", "control plane",
                "execution plane", "D-061")):
            return UNKNOWN
    elif identifier == "README-05-02":
        if not manifests_match(sources) or "smoke #122" not in readme:
            return UNKNOWN
    elif identifier == "README-05-03":
        activation = sources["factory-control-activation.js"]
        fixture = sources["test-factory-control-activation.cjs"]
        if ("declarativo" not in readme or "#129" not in readme
                or "loadVerifiedLegalGate" not in activation
                or "loadVerifiedHeartbeatConsent" not in activation
                or "loadVerifiedPairing" not in activation
                or "consent_denied" not in fixture
                or "legal_blocked" not in fixture
                or node_result != NODE_MARKER):
            return UNKNOWN
    elif identifier == "README-06-01":
        if (not manifests_match(sources) or "Node ≥20" not in agents
                or "Safari/Xcode" not in readme
                or "JavaScript" not in readme):
            return UNKNOWN
    elif identifier == "README-06-02":
        try:
            package = json.loads(sources["package.json"])
            scripts = package["scripts"]
        except (ValueError, TypeError, KeyError):
            return UNKNOWN
        workflow = sources[".github/workflows/validate.yml"]
        if ("npm test" not in readme or "Node.js ≥20" not in readme
                or "node --check" not in scripts.get("test", "")
                or not scripts.get("pretest", "").startswith("python3 -m unittest")
                or len(re.findall(r"(?m)^      - run: npm test\s*$", workflow)) != 1
                or "node-version: 20" not in workflow
                or "Validate / Pruebas y smoke Chrome" not in workflow):
            return UNKNOWN
    return LOCAL_CONTRACT


@lru_cache(maxsize=1)
def synthetic_activation() -> str:
    """Exercise existing fake-clock Node assertions in a scrubbed environment."""
    node = shutil.which("node")
    if node is None:
        return UNKNOWN
    env = {"PATH": os.path.dirname(node) + os.pathsep + "/usr/bin:/bin",
           "CI": "true"}
    try:
        done = subprocess.run(
            [node, str(ROOT / "test-factory-control-activation.cjs")],
            cwd=ROOT, env=env, capture_output=True, text=True,
            check=False, timeout=40,
        )
    except (OSError, subprocess.TimeoutExpired):
        return UNKNOWN
    return NODE_MARKER if done.returncode == 0 and done.stdout.strip() == NODE_MARKER else UNKNOWN


def operational_evidence(_identifier: object, _claimed: object = None) -> str:
    """A README/Node fixture/green CI never certifies install, pairing or live."""
    return UNKNOWN


class BrechasAutofactory24Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: five explicit, independent contracts with executable negatives."""
        sources = source_text()
        self.assertEqual(set(matrix_rows(sources[SOURCES[0]])), set(GAPS))
        self.assertEqual(synthetic_activation(), NODE_MARKER)
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(contract(identifier, sources, synthetic_activation()),
                                 LOCAL_CONTRACT)
                self.assertEqual(operational_evidence(identifier), UNKNOWN)

    def test_falla_cerrado(self) -> None:
        """AC-02: malformed evidence, inactive legal gate or missing tests are UNKNOWN."""
        sources = source_text()
        matrix = sources[SOURCES[0]]
        for identifier in GAPS:
            row = next(line for line in matrix.splitlines()
                       if line.startswith(f"| {identifier} ·"))
            for damaged in (matrix.replace(row + "\n", "", 1),
                            matrix + "\n" + row,
                            matrix.replace(row, row.replace("NO_VERIFICABLE", "CUBIERTO"), 1)):
                with self.subTest(identifier=identifier), self.assertRaisesRegex(
                        ValueError, "UNKNOWN"):
                    matrix_rows(damaged)
        mutations = {
            "README-05-01": ("README.md", "FactoryRunner", "runner-inventado"),
            "README-05-02": ("manifest.json", '"manifest_version": 3', '"manifest_version": 2'),
            "README-05-03": ("test-factory-control-activation.cjs", "legal_blocked", "legal_unknown"),
            "README-06-01": ("AGENTES.md", "Node ≥20", "Node?"),
            "README-06-02": (".github/workflows/validate.yml", "      - run: npm test", "      - run: echo skipped"),
        }
        for identifier, (path, original, replacement) in mutations.items():
            damaged = dict(sources)
            self.assertIn(original, damaged[path])
            damaged[path] = damaged[path].replace(original, replacement)
            with self.subTest(identifier=identifier):
                self.assertEqual(contract(identifier, damaged, NODE_MARKER), UNKNOWN)
        bad_legal = dict(sources)
        changed = json.loads(bad_legal["decisiones.yml"])
        for entry in changed["decisions"]:
            if entry.get("id") == "D-061":
                entry["status"] = "revoked"
        bad_legal["decisiones.yml"] = json.dumps(changed)
        for identifier in GAPS:
            self.assertEqual(contract(identifier, bad_legal, NODE_MARKER), UNKNOWN)
        self.assertEqual(contract("README-05-03", sources, "claimed ready"), UNKNOWN)
        self.assertEqual(contract("README-05-03", {}, NODE_MARKER), UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        """AC-03: fixtures only; subprocess never inherits secrets or chat data."""
        self.assertEqual(synthetic_activation(), NODE_MARKER)
        source = Path(__file__).read_text(encoding="utf-8")
        self.assertIn("env=env, capture_output=True", source)
        self.assertIn('"CI": "true"', source)
        tree = ast.parse(source)
        imported = {alias.name.split(".")[0]
                    for item in ast.walk(tree) if isinstance(item, ast.Import)
                    for alias in item.names}
        imported |= {item.module.split(".")[0]
                     for item in ast.walk(tree)
                     if isinstance(item, ast.ImportFrom) and item.module}
        self.assertFalse(imported & {"requests", "urllib", "http", "socket"})
        self.assertNotIn("os.environ" + ".copy()", source)
        self.assertNotIn("Authorization:" + " Bearer ", source)
        self.assertEqual(operational_evidence("README-05-03", {
            "synthetic": True, "pairing": "ready", "ci": "success"
        }), UNKNOWN)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: do not infer delivery or legal approval from local evidence."""
        sources = source_text()
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(contract(identifier, sources, synthetic_activation()),
                                 LOCAL_CONTRACT)
                for claim in (None, {}, True, {"ci": "success"},
                              {"node": NODE_MARKER}, {"smoke": "claimed"},
                              {"paired": True, "consent": True},
                              {"installed": True, "release": "claimed"}):
                    self.assertEqual(operational_evidence(identifier, claim), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
