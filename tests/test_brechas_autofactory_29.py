"""#336: five README requirements, offline synthetic and fail-closed.

The test never builds Safari, runs npm recursively or requests credentials.
Local contracts are not live release, installation or ControlBot evidence.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "UNKNOWN"
LOCAL = "CONTRATO_LOCAL"
MATRIX = "docs/matriz-cobertura.md"
REPORT = "docs/contraste-af_readme.md"
README = "README.md"
PACKAGE = "package.json"
SAFARI = "build-safari.sh"
WORKFLOW = ".github/workflows/validate.yml"
AGENTS = "AGENTES.md"
SOURCES = (MATRIX, REPORT, README, PACKAGE, SAFARI, WORKFLOW,
           AGENTS, "datos.yml")
GAPS = {
    "README-10-01": ("Desarrollo local", "Ejecutar npm ci y npm test con Node.js >=20"),
    "README-10-02": ("Desarrollo local", "Compilar Safari con build-safari.sh exige macOS y Xcode"),
    "README-10-03": ("Desarrollo local", "Ejecutar la suite local no requiere credenciales reales"),
    "README-11-01": ("Mapa de la fábrica", "Factory — governance/kit y contratos comunes"),
    "README-11-02": ("Mapa de la fábrica", "ControlBot — control plane, priorización, elegibilidad y estado durable"),
}
README_TOKENS = {
    "README-10-01": ("Requisitos: Node.js >=20. Para Safari, macOS + Xcode.",
                     "npm ci --ignore-scripts --no-audit --no-fund", "npm test"),
    "README-10-02": ("Para Safari:", "./build-safari.sh", "macOS + Xcode"),
    "README-10-03": ("No se requieren credenciales reales para ejecutar la suite local.",),
    "README-11-01": ("- **Factory** — governance/kit y contratos comunes.",),
    "README-11-02": ("- **ControlBot** — control plane, priorización, elegibilidad y estado durable.",),
}


def read_sources() -> dict[str, str]:
    return {path: (ROOT / path).read_text(encoding="utf-8") for path in SOURCES}


def rows(document: object, kind: str) -> dict[str, tuple[str, ...]]:
    """Exactly one complete NO_VERIFICABLE record for every requirement."""
    if not isinstance(document, str) or kind not in ("matrix", "contrast"):
        raise ValueError("UNKNOWN: invalid source")
    result = {}
    for key, (heading, requirement) in GAPS.items():
        prefix = "| " + key + (" ·" if kind == "matrix" else " |")
        matches = [line for line in document.splitlines() if line.startswith(prefix)]
        if len(matches) != 1:
            raise ValueError("UNKNOWN: missing or ambiguous " + key)
        cells = tuple(x.strip() for x in matches[0].strip("|").split("|"))
        if len(cells) != 5 or not all(cells):
            raise ValueError("UNKNOWN: incomplete " + key)
        if kind == "matrix":
            valid = (cells[0] == key + " · README.md"
                     and cells[2] == "NO_VERIFICABLE"
                     and "Contraste #292" in cells[3]
                     and "Estado operativo: UNKNOWN" in cells[3]
                     and "Falta evidencia específica para " + key in cells[3])
        else:
            valid = (cells[0] == key
                     and cells[3] == "NO_VERIFICABLE"
                     and "README.md" in cells[2]
                     and "tests/test_matriz_cobertura.py" in cells[2]
                     and "Falta evidencia específica para " + key in cells[4])
        if not valid or heading not in cells[1] or requirement not in cells[1]:
            raise ValueError("UNKNOWN: source drift " + key)
        result[key] = cells
    return result


def section(document: object, name: str) -> str | None:
    marker = "## " + name + "\n"
    if not isinstance(document, str) or document.count(marker) != 1:
        return None
    return document.split(marker, 1)[1].split("\n## ", 1)[0]


def node_major(value: object) -> int | None:
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value)
    return int(match.group(1)) if match else None


def classify(key: object, source: object) -> str:
    """Only classify a reproducible checkout contract, never execution."""
    if key not in GAPS or not isinstance(source, dict):
        return UNKNOWN
    if not all(isinstance(source.get(p), str) and source[p] for p in SOURCES):
        return UNKNOWN
    try:
        matrix = rows(source[MATRIX], "matrix")
        report = rows(source[REPORT], "contrast")
        package = json.loads(source[PACKAGE])
        privacy = json.loads(source["datos.yml"])
    except (ValueError, KeyError, TypeError, AttributeError):
        return UNKNOWN
    if key not in matrix or key not in report or privacy.get("phase") != "construccion":
        return UNKNOWN
    content = section(source[README], GAPS[key][0])
    if content is None or any(t not in content for t in README_TOKENS[key]):
        return UNKNOWN
    if key == "README-10-01":
        workflow = source[WORKFLOW]
        if (package.get("engines", {}).get("node") != ">=20"
                or not package.get("scripts", {}).get("test")
                or not package.get("scripts", {}).get("pretest")
                or "node-version: 20" not in workflow
                or "- run: npm ci --ignore-scripts" not in workflow
                or "- run: npm test" not in workflow
                or "github.event.pull_request.head.sha || github.sha" not in workflow):
            return UNKNOWN
    elif key == "README-10-02":
        if not all(t in source[SAFARI] for t in (
                "#!/bin/zsh", "set -euo pipefail", "xcodebuild",
                "CODE_SIGNING_ALLOWED=NO", "ChatGPT Autopilot Local.xcodeproj",
                "verify-extension-assets.cjs")):
            return UNKNOWN
    elif key == "README-10-03":
        scripts = package.get("scripts")
        if (not isinstance(scripts, dict) or not scripts.get("test")
                or not scripts.get("pretest")
                or any(t in " ".join(scripts.values()).lower() for t in (
                    "github_token=", "authorization: bearer",
                    "npm publish", "gh auth login", "curl http"))):
            return UNKNOWN
    elif key == "README-11-01":
        if not all(t in source[AGENTS] for t in (
                "núcleo operativo compartido de Factory v1",
                "factory/blob/v1/agentes/NUCLEO.md", "PLAN-AGENTES.md")):
            return UNKNOWN
    elif key == "README-11-02":
        if not all(t in source[AGENTS] for t in (
                "ControlBot", "D-061", "sin endpoints reales",
                "consentimientos verificables")):
            return UNKNOWN
        if "AutoFactory no se fusiona con FactoryRunner" not in source[README]:
            return UNKNOWN
    return LOCAL


def operational(_key: object, _evidence: object = None) -> str:
    return UNKNOWN


class BrechasAutofactory29Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = read_sources()
        cls.matrix = rows(cls.source[MATRIX], "matrix")
        cls.report = rows(cls.source[REPORT], "contrast")

    def test_contrato_principal(self):
        """AC-01: executable checks cover all five IDs."""
        self.assertEqual(set(self.matrix), set(GAPS))
        self.assertEqual(set(self.report), set(GAPS))
        self.assertTrue((ROOT / "safari/ChatGPT Autopilot Local.xcodeproj/project.pbxproj").is_file())
        for key in GAPS:
            with self.subTest(key=key):
                self.assertEqual(classify(key, self.source), LOCAL)
                self.assertEqual(operational(key), UNKNOWN)
        self.assertEqual(node_major("v20.0.0"), 20)
        self.assertEqual(node_major("22.4.1"), 22)

    def test_falla_cerrado(self):
        """AC-02: absent/duplicated/promoted rows and inconsistent code fail."""
        for filename, kind in ((MATRIX, "matrix"), (REPORT, "contrast")):
            for key in GAPS:
                prefix = "| " + key + (" ·" if kind == "matrix" else " |")
                line = next(x for x in self.source[filename].splitlines()
                            if x.startswith(prefix))
                for altered in (self.source[filename].replace(line, "", 1),
                                self.source[filename] + "\n" + line,
                                self.source[filename].replace(
                                    line, line.replace("NO_VERIFICABLE", "CUBIERTO"), 1)):
                    with self.subTest(filename=filename, key=key):
                        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                            rows(altered, kind)
        for key in GAPS:
            broken = dict(self.source)
            token = README_TOKENS[key][0]
            self.assertIn(token, broken[README])
            broken[README] = broken[README].replace(token, "UNVERIFIED", 1)
            self.assertEqual(classify(key, broken), UNKNOWN)
            self.assertEqual(classify(key, {}), UNKNOWN)
        for filename, token, key in (
                (PACKAGE, '"node": ">=20"', "README-10-01"),
                (WORKFLOW, "node-version: 20", "README-10-01"),
                (SAFARI, "CODE_SIGNING_ALLOWED=NO", "README-10-02"),
                (AGENTS, "núcleo operativo compartido de Factory v1", "README-11-01"),
                (AGENTS, "sin endpoints reales", "README-11-02")):
            broken = dict(self.source)
            self.assertIn(token, broken[filename])
            broken[filename] = broken[filename].replace(token, "UNVERIFIED", 1)
            self.assertEqual(classify(key, broken), UNKNOWN)
        for value in ("v19.9.9", "19.0.0", "22", "", None, True, "v20.0.0-rc1"):
            self.assertTrue(node_major(value) is None or node_major(value) < 20)

    def test_sin_datos_reales(self):
        """AC-03: static files, synthetic inputs, no network or secrets."""
        tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
        imports = {alias.name.split(".")[0] for node in ast.walk(tree)
                   if isinstance(node, ast.Import) for alias in node.names}
        imports |= {node.module.split(".")[0] for node in ast.walk(tree)
                    if isinstance(node, ast.ImportFrom) and node.module}
        self.assertFalse(imports & {
            "requests", "socket", "urllib", "http", "httpx", "subprocess", "os"})
        self.assertEqual(json.loads(self.source["datos.yml"])["phase"], "construccion")
        for key in GAPS:
            self.assertEqual(operational(key, {"credential": "synthetic"}), UNKNOWN)

    def test_estados_unknown_explicitos(self):
        """AC-04: CI, Safari installation and ControlBot remain UNKNOWN."""
        for key in GAPS:
            with self.subTest(key=key):
                self.assertEqual(self.matrix[key][2], "NO_VERIFICABLE")
                self.assertEqual(self.report[key][3], "NO_VERIFICABLE")
                self.assertEqual(classify(key, self.source), LOCAL)
                for alleged in (
                    None, {}, True, {"npm": "success"},
                    {"macos": True, "xcode": "installed"},
                    {"ci": "green", "exact_sha": "a" * 40},
                    {"controlbot": "connected", "owner_approved": True},
                    {"safari": "installed", "runtime": "ready"}):
                    self.assertEqual(operational(key, alleged), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
