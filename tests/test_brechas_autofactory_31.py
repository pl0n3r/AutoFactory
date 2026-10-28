#!/usr/bin/env python3
"""AutoFactory #338: local offline contracts for README-12-03..README-12-07.

A synthetic/static checkout test cannot attest a Chrome load, a tab reload,
a macOS/Xcode installation, or a successful Safari build. Those are UNKNOWN.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "UNKNOWN"
LOCAL = "CONTRATO_DOCUMENTAL_LOCAL"
MATRIX = "docs/matriz-cobertura.md"
CONTRAST = "docs/contraste-af_readme.md"
README = "README.md"
MANIFEST = "manifest.json"
SAFARI = "build-safari.sh"
AGENTS = "AGENTES.md"
DATA = "datos.yml"
SOURCES = (MATRIX, CONTRAST, README, MANIFEST, SAFARI, AGENTS, DATA)
GAPS = {
    "README-12-03": (
        "Instalación y uso — Pulsa Cargar descomprimida",
        "3. Pulsa **Cargar descomprimida**.",
    ),
    "README-12-04": (
        "Instalación y uso — Selecciona la carpeta raíz que clonaste",
        "4. Selecciona la carpeta raíz que clonaste.",
    ),
    "README-12-05": (
        "Instalación y uso — Recarga las pestañas de ChatGPT que ya estaban abiertas",
        "5. Recarga las pestañas de ChatGPT que ya estaban abiertas.",
    ),
    "README-12-06": (
        "Instalación y uso — Clona el repositorio en macOS con Xcode instalado",
        "1. Clona el repositorio en macOS con Xcode instalado.",
    ),
    "README-12-07": (
        "Instalación y uso — Ejecuta ./build-safari.sh desde la raíz",
        "2. Ejecuta `./build-safari.sh` desde la raíz.",
    ),
}


def read_sources() -> dict[str, str]:
    """Read only checked-out, non-secret, committed sources."""
    return {filename: (ROOT / filename).read_text(encoding="utf-8")
            for filename in SOURCES}


def rows(document: object, kind: str) -> dict[str, tuple[str, ...]]:
    """Complete, unique, non-promoted matrix and contrast evidence."""
    if not isinstance(document, str) or kind not in ("matrix", "contrast"):
        raise ValueError("UNKNOWN: missing audit document")
    found = {}
    for identifier, (requirement, _) in GAPS.items():
        prefix = "| " + identifier + (" ·" if kind == "matrix" else " |")
        matches = [line for line in document.splitlines()
                   if line.startswith(prefix)]
        if len(matches) != 1:
            raise ValueError("UNKNOWN: missing or ambiguous " + identifier)
        cells = tuple(cell.strip() for cell in matches[0].strip("|").split("|"))
        if len(cells) != 5 or not all(cells):
            raise ValueError("UNKNOWN: incomplete row " + identifier)
        if kind == "matrix":
            valid = (
                cells[0] == identifier + " · README.md"
                and cells[1] == requirement
                and cells[2] == "NO_VERIFICABLE"
                and "Contraste #292" in cells[3]
                and "Estado operativo: UNKNOWN" in cells[3]
                and "Falta evidencia específica para " + identifier in cells[3]
                and "Falta smoke de la acción manual" in cells[3]
            )
        else:
            valid = (
                cells[0] == identifier
                and cells[1] == "README.md — " + requirement
                and cells[3] == "NO_VERIFICABLE"
                and "`README.md`" in cells[2]
                and "`tests/test_matriz_cobertura.py`" in cells[2]
                and "Falta evidencia específica para " + identifier in cells[4]
                and "Falta smoke de la acción manual" in cells[4]
            )
        if not valid:
            raise ValueError("UNKNOWN: unverified row drift " + identifier)
        found[identifier] = cells
    return found


def installation_section(document: object) -> str | None:
    """Reject ambiguous headings and an absent installation section."""
    if not isinstance(document, str):
        return None
    heading = "## Instalación y uso\n"
    if document.count(heading) != 1:
        return None
    return document.split(heading, 1)[1].split("\n## ", 1)[0]


def classify(identifier: object, evidence: object) -> str:
    """Attest only local instructions and safe scaffolding, not installed state."""
    if identifier not in GAPS or not isinstance(evidence, dict):
        return UNKNOWN
    if not all(isinstance(evidence.get(name), str) and evidence[name]
               for name in SOURCES):
        return UNKNOWN
    try:
        matrix, contrast = rows(evidence[MATRIX], "matrix"), rows(evidence[CONTRAST], "contrast")
        manifest = json.loads(evidence[MANIFEST])
        data = json.loads(evidence[DATA])
    except (ValueError, KeyError, TypeError, AttributeError):
        return UNKNOWN
    if (identifier not in matrix or identifier not in contrast
            or not isinstance(manifest, dict) or not isinstance(data, dict)
            or data.get("phase") != "construccion"
            or manifest.get("manifest_version") != 3
            or manifest.get("host_permissions") != ["https://chatgpt.com/*"]
            or manifest.get("action", {}).get("default_popup") != "popup.html"
            or "extensión Chrome y Safari" not in evidence[AGENTS]
            or "no servidor web" not in evidence[AGENTS]):
        return UNKNOWN
    scripts = manifest.get("content_scripts")
    if (not isinstance(scripts, list) or not scripts
            or not any(isinstance(item, dict)
                       and item.get("matches") == ["https://chatgpt.com/*"]
                       and "content.js" in item.get("js", [])
                       for item in scripts)):
        return UNKNOWN
    section = installation_section(evidence[README])
    if (section is None
            or section.splitlines().count(GAPS[identifier][1]) != 1
            or "### Instalar en Chrome" not in section
            or "### Instalar en Safari" not in section):
        return UNKNOWN

    if identifier in ("README-12-03", "README-12-04", "README-12-05"):
        if ("1. Abre `chrome://extensions`." not in section
                or "2. Activa **Modo de desarrollador**." not in section):
            return UNKNOWN
        if identifier == "README-12-04" and "4. Selecciona la carpeta raíz que clonaste." not in section:
            return UNKNOWN
        if identifier == "README-12-05" and "5. Recarga las pestañas de ChatGPT que ya estaban abiertas." not in section:
            return UNKNOWN
    else:
        build = evidence[SAFARI]
        required = (
            "#!/bin/zsh", "set -euo pipefail", 'ROOT="${0:A:h}"',
            "declaredExtensionAssets", 'cp "$ROOT/$file" "$RESOURCES/$file"',
            "verify-extension-assets.cjs", "xcodebuild",
            "ChatGPT Autopilot Local.xcodeproj", "CODE_SIGNING_ALLOWED=NO",
        )
        if ("macOS + Xcode" not in evidence[AGENTS]
                or not all(token in build for token in required)):
            return UNKNOWN
        if identifier == "README-12-07" and "./build-safari.sh" not in section:
            return UNKNOWN
    return LOCAL


def operational_evidence(_identifier: object, _observation: object = None) -> str:
    """No synthetic or CI input certifies actual manual installation/build."""
    return UNKNOWN


class BrechasAutofactory31Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: all five matrix requirements have independently checked contracts."""
        evidence = read_sources()
        self.assertEqual(set(rows(evidence[MATRIX], "matrix")), set(GAPS))
        self.assertEqual(set(rows(evidence[CONTRAST], "contrast")), set(GAPS))
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(classify(identifier, evidence), LOCAL)
                self.assertEqual(operational_evidence(identifier), UNKNOWN)

    def test_falla_cerrado(self) -> None:
        """AC-02: missing/duplicate/promoted rows and altered installation fail."""
        evidence = read_sources()
        for filename, kind in ((MATRIX, "matrix"), (CONTRAST, "contrast")):
            for identifier in GAPS:
                prefix = "| " + identifier + (" ·" if kind == "matrix" else " |")
                line = next(x for x in evidence[filename].splitlines()
                            if x.startswith(prefix))
                changes = (
                    evidence[filename].replace(line, "", 1),
                    evidence[filename] + "\n" + line,
                    evidence[filename].replace(
                        line, line.replace("NO_VERIFICABLE", "CUBIERTO", 1), 1),
                    evidence[filename].replace(
                        line, line.replace("Falta evidencia específica", "Smoke OK", 1), 1),
                )
                for altered in changes:
                    with self.subTest(source=kind, identifier=identifier):
                        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                            rows(altered, kind)
        for identifier, (_, line) in GAPS.items():
            damaged = dict(evidence)
            self.assertIn(line, damaged[README])
            damaged[README] = damaged[README].replace(line, "Not observed", 1)
            with self.subTest(instruction=identifier):
                self.assertEqual(classify(identifier, damaged), UNKNOWN)
                self.assertEqual(classify(identifier, {}), UNKNOWN)
        for filename, fragment, identifier in (
            (SAFARI, "CODE_SIGNING_ALLOWED=NO", "README-12-07"),
            (SAFARI, "xcodebuild", "README-12-06"),
            (AGENTS, "macOS + Xcode", "README-12-06"),
            (MANIFEST, '"manifest_version": 3', "README-12-03"),
            (MANIFEST, '"https://chatgpt.com/*"', "README-12-05"),
        ):
            altered = dict(evidence)
            self.assertIn(fragment, evidence[filename])
            altered[filename] = altered[filename].replace(fragment, "MISSING", 1)
            self.assertEqual(classify(identifier, altered), UNKNOWN)
        self.assertEqual(classify("README-12-03", {
            **evidence, MANIFEST: "{invalid",
        }), UNKNOWN)
        self.assertEqual(classify("README-12-03", {
            **evidence, DATA: '{"phase":"live"}',
        }), UNKNOWN)
        self.assertEqual(classify("README-12-99", evidence), UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        """AC-03: no browser, network, secrets, external commands or personal data."""
        tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
        imports = {alias.name.split(".")[0] for node in ast.walk(tree)
                   if isinstance(node, ast.Import) for alias in node.names}
        imports |= {node.module.split(".")[0] for node in ast.walk(tree)
                    if isinstance(node, ast.ImportFrom) and node.module}
        self.assertFalse(imports & {
            "socket", "urllib", "requests", "http", "httpx", "subprocess",
            "selenium", "playwright", "os", "keyring",
        })
        self.assertEqual(set(SOURCES), {
            MATRIX, CONTRAST, README, MANIFEST, SAFARI, AGENTS, DATA,
        })
        self.assertEqual(json.loads(read_sources()[DATA])["phase"], "construccion")
        for identifier in GAPS:
            self.assertEqual(operational_evidence(
                identifier, {"installed": True, "secret": "synthetic-only"}), UNKNOWN)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: never infer installation/smoke from README or successful CI."""
        evidence = read_sources()
        matrix, contrast = rows(evidence[MATRIX], "matrix"), rows(evidence[CONTRAST], "contrast")
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(matrix[identifier][2], "NO_VERIFICABLE")
                self.assertEqual(contrast[identifier][3], "NO_VERIFICABLE")
                self.assertEqual(classify(identifier, evidence), LOCAL)
                for claim in (None, True, {}, {"ci": "success"},
                              {"chrome": "loaded", "permissions": "granted"},
                              {"chrome": "tabs_reloaded", "root": "cloned"},
                              {"os": "macOS", "xcode": "installed"},
                              {"safari": "build_ok", "smoke": "green"},
                              {"owner_approved": True, "live": True}):
                    self.assertEqual(operational_evidence(identifier, claim), UNKNOWN)
        self.assertIsNone(installation_section("## Instalación y uso\n## Instalación y uso\n"))
        self.assertEqual(classify(None, evidence), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
