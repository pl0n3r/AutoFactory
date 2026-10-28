#!/usr/bin/env python3
"""AutoFactory #332: five offline README gaps, no operational claims.

Local static assertions never certify installation, release, LAN permission,
live pairing or production. Ambiguous or missing evidence is UNKNOWN.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "UNKNOWN"
LOCAL_ONLY = "LOCAL_ONLY"
GAPS = {
    "README-06-03": ("Stack e infraestructura", "No existe backend Hostinger ni base de datos propios"),
    "README-06-04": ("Stack e infraestructura", "Permiso LAN opcional"),
    "README-06-05": ("Stack e infraestructura", "Releases: GitHub Releases"),
    "README-07-01": ("Ciclo de entrega", "Issue → estado/reserva"),
    "README-07-02": ("Ciclo de entrega", "Cuando el bot de coordinación no esté instalado"),
}
SOURCES = (
    "README.md", "docs/matriz-cobertura.md", "docs/contraste-af_readme.md",
    "AGENTES.md", "CHANGELOG.md", ".github/workflows/validate.yml",
    "manifest.json", "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json",
    "package.json", "package-lock.json",
)


def source_text() -> dict[str, str]:
    """Read only public source contracts, not environment, secrets or user data."""
    return {path: (ROOT / path).read_text(encoding="utf-8") for path in SOURCES}


def matrix_rows(document: str) -> dict[str, tuple[str, ...]]:
    """Reject missing, duplicate, relabeled, incomplete or promoted coverage."""
    if not isinstance(document, str):
        raise ValueError("UNKNOWN: unreadable matrix")
    rows = {}
    for identifier, (heading, statement) in GAPS.items():
        hits = [line for line in document.splitlines()
                if line.startswith(f"| {identifier} ·")]
        if len(hits) != 1:
            raise ValueError(f"UNKNOWN: missing or duplicate {identifier}")
        cells = tuple(cell.strip() for cell in hits[0].strip("|").split("|"))
        if (len(cells) != 5 or not all(cells)
                or cells[0] != identifier + " · README.md"
                or cells[2] != "NO_VERIFICABLE"
                or not cells[1].startswith(heading + " — " + statement)
                or "Contraste #292" not in cells[3]
                or "Estado operativo: UNKNOWN" not in cells[3]
                or identifier not in cells[3]):
            raise ValueError(f"UNKNOWN: damaged or promoted {identifier}")
        rows[identifier] = cells
    return rows


def section(document: str, heading: str) -> str:
    if not isinstance(document, str):
        return ""
    lines = document.splitlines()
    starts = [i for i, line in enumerate(lines) if line.strip() == "## " + heading]
    if len(starts) != 1:
        return ""
    begin = starts[0] + 1
    end = next((i for i in range(begin, len(lines))
                if lines[i].startswith("## ")), len(lines))
    return "\n".join(lines[begin:end])


def manifests_and_packages(sources: dict[str, str]) -> bool:
    try:
        chrome = json.loads(sources["manifest.json"])
        safari = json.loads(sources[
            "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json"])
        package = json.loads(sources["package.json"])
        lock = json.loads(sources["package-lock.json"])
        versions = (chrome["version"], safari["version"], package["version"],
                    lock["version"], lock["packages"][""]["version"])
        return (len(set(versions)) == 1 and chrome["manifest_version"] == 3
                and safari["manifest_version"] == 3
                and package["engines"]["node"] == ">=20")
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def local_contract(identifier: str, sources: dict[str, str]) -> str:
    """Prove a narrow executable local contract, never operational readiness."""
    if identifier not in GAPS or not isinstance(sources, dict):
        return UNKNOWN
    if any(not isinstance(sources.get(path), str) or not sources[path].strip()
           for path in SOURCES):
        return UNKNOWN
    try:
        row = matrix_rows(sources["docs/matriz-cobertura.md"])[identifier]
    except (KeyError, TypeError, ValueError):
        return UNKNOWN
    heading, statement = GAPS[identifier]
    readme = section(sources["README.md"], heading)
    readme_marker = "GitHub Releases" if identifier == "README-06-05" else statement
    if not readme or readme_marker not in readme or statement not in row[1]:
        return UNKNOWN
    contrast = [line for line in sources["docs/contraste-af_readme.md"].splitlines()
                if line.startswith(f"| {identifier} |")]
    if len(contrast) != 1 or "NO_VERIFICABLE" not in contrast[0]:
        return UNKNOWN
    agents = sources["AGENTES.md"]
    ci = sources[".github/workflows/validate.yml"]
    if identifier == "README-06-03":
        ok = ("extensión Chrome y Safari, no servidor web" in agents
              and "Node ≥20" in agents and manifests_and_packages(sources))
    elif identifier == "README-06-04":
        try:
            chrome = json.loads(sources["manifest.json"])
            safari = json.loads(sources[
                "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json"])
            ok = ("http://*/*" in chrome["optional_host_permissions"]
                  and "http://*/*" in safari["optional_host_permissions"]
                  and "http://*/*" not in chrome["host_permissions"]
                  and "http://*/*" not in safari["host_permissions"]
                  and "## 1.7.36" in sources["CHANGELOG.md"]
                  and "No se concede al instalar" in sources["CHANGELOG.md"]
                  and "no equivale a autorización permanente de red" in readme)
        except (KeyError, TypeError, ValueError):
            ok = False
    elif identifier == "README-06-05":
        ok = (manifests_and_packages(sources)
              and "rollback al paquete anterior" in readme
              and "Releases oficiales" in sources["README.md"]
              and "conservar la release anterior instalable" in agents)
    elif identifier == "README-07-01":
        ok = ("trabajo/issue-N" in readme
              and "PR → tests/Factory gates" in readme
              and "merge serial → release oficial" in readme
              and "smoke de instalación/carga Chrome/Safari" in readme
              and "name: Validate" in ci and "npm test" in ci
              and "pull_request:" in ci and "smoke de instalación/carga" in agents)
    else:
        ok = ("comentario de plan" in readme
              and "estado: reservado" in readme
              and "sin inventar UUID" in readme
              and "si el bot " + chr(96) + "/tomar" + chr(96) + " no está instalado" in agents
              and "sin inventar UUID" in agents)
    return LOCAL_ONLY if ok else UNKNOWN


def operational_evidence(_identifier: object, _claim: object = None) -> str:
    """Synthetic observations and green CI cannot certify operational behavior."""
    return UNKNOWN


class BrechasAutofactory25Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: five independent local assertions, explicitly partial."""
        sources = source_text()
        self.assertEqual(set(matrix_rows(sources["docs/matriz-cobertura.md"])), set(GAPS))
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(local_contract(identifier, sources), LOCAL_ONLY)
                self.assertEqual(operational_evidence(identifier), UNKNOWN)

    def test_falla_cerrado(self) -> None:
        """AC-02: missing, duplicate, promoted and tampered evidence is UNKNOWN."""
        sources = source_text()
        matrix = sources["docs/matriz-cobertura.md"]
        for identifier in GAPS:
            row = next(line for line in matrix.splitlines()
                       if line.startswith(f"| {identifier} ·"))
            for damaged in (matrix.replace(row + "\n", "", 1),
                            matrix + "\n" + row,
                            matrix.replace(row, row.replace("NO_VERIFICABLE", "VALIDADO"), 1)):
                with self.subTest(identifier=identifier), self.assertRaisesRegex(
                        ValueError, "UNKNOWN"):
                    matrix_rows(damaged)
        current_version = json.loads(sources["package.json"])["version"]
        changes = {
            "README-06-03": ("package.json", '"engines"', '"other"'),
            "README-06-04": ("manifest.json", '"http://*/*"', '"https://invalid.example/*"'),
            "README-06-05": ("package.json", f'"version": "{current_version}"', '"version": "0.0.0"'),
            "README-07-01": (".github/workflows/validate.yml", "      - run: npm test", "      - run: echo bypass"),
            "README-07-02": ("AGENTES.md", "sin inventar UUID", "inventar UUID"),
        }
        for identifier, (path, before, after) in changes.items():
            changed = dict(sources)
            self.assertIn(before, changed[path])
            changed[path] = changed[path].replace(before, after)
            with self.subTest(tamper=identifier):
                self.assertEqual(local_contract(identifier, changed), UNKNOWN)
        self.assertEqual(local_contract("README-99-99", sources), UNKNOWN)
        self.assertEqual(local_contract("README-06-03", {}), UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        """AC-03: synthetic-only fixtures and a fixed set of local files."""
        fixture = {"actor": "synthetic-owner", "browser": "synthetic-chrome",
                   "release": "synthetic-v0", "result": "synthetic-unknown"}
        self.assertTrue(all(v.startswith("synthetic-") for v in fixture.values()))
        self.assertEqual(set(source_text()), set(SOURCES))
        code = Path(__file__).read_text(encoding="utf-8")
        tree = ast.parse(code)
        modules = {alias.name.split(".")[0] for node in ast.walk(tree)
                   if isinstance(node, ast.Import) for alias in node.names}
        modules |= {node.module.split(".")[0] for node in ast.walk(tree)
                    if isinstance(node, ast.ImportFrom) and node.module}
        self.assertFalse(modules & {"requests", "urllib", "socket", "http"})
        self.assertEqual(operational_evidence("README-06-04", fixture), UNKNOWN)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: optimistic claims never replace release/install/smoke proof."""
        sources = source_text()
        claims = (None, {}, {"ci": "success"}, {"sonar": "success"},
                  {"permission_granted": True}, {"release": "published"},
                  {"manifest_parity": True}, {"installed": True, "smoke": "ok"},
                  {"v3_reservation": "synthetic-uuid", "merge": True})
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(local_contract(identifier, sources), LOCAL_ONLY)
                for claim in claims:
                    self.assertEqual(operational_evidence(identifier, claim), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
