#!/usr/bin/env python3
"""AutoFactory #335: evidencia documental offline de README-09-01..09-05.

Los enlaces y contratos locales se contrastan con archivos del checkout. Su
presencia NO certifica estado actual de GitHub, releases o instalación real.
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
CONTRAST = "docs/contraste-af_readme.md"
README = "README.md"
SOURCES = (
    MATRIX, CONTRAST, README, "AGENTES.md", "decisiones.yml", "datos.yml",
    "CHANGELOG.md", ".github/workflows/coordinacion.yml",
)
GAPS = {
    "README-09-01": ("Puente y alcance", "roadmap #1 y readiness #134"),
    "README-09-02": ("Ejecución y revisiones", "Issues y PRs"),
    "README-09-03": ("Decisiones y límites", "decisiones.yml, AGENTES.md, datos.yml"),
    "README-09-04": ("Versiones reales", "CHANGELOG.md y GitHub Releases"),
    "README-09-05": ("Protocolo transversal", "PLAN-AGENTES.md"),
}
REFERENCES = {
    "README-09-01": (
        "[roadmap #1](https://github.com/pl0n3r/AutoFactory/issues/1)",
        "[readiness #134](https://github.com/pl0n3r/AutoFactory/issues/134)",
    ),
    "README-09-02": (
        "[Issues](https://github.com/pl0n3r/AutoFactory/issues)",
        "[PRs](https://github.com/pl0n3r/AutoFactory/pulls)",
    ),
    "README-09-03": (
        "[decisiones.yml](decisiones.yml)", "[AGENTES.md](AGENTES.md)",
        "[datos.yml](datos.yml)",
    ),
    "README-09-04": (
        "[CHANGELOG.md](CHANGELOG.md)",
        "[GitHub Releases](https://github.com/pl0n3r/AutoFactory/releases)",
    ),
    "README-09-05": (
        "[PLAN-AGENTES.md](https://github.com/pl0n3r/factory/blob/main/PLAN-AGENTES.md)",
    ),
}


def read_sources() -> dict[str, str]:
    """Only checked-in local text; never fetch GitHub or access browser state."""
    return {path: (ROOT / path).read_text(encoding="utf-8") for path in SOURCES}


def rows(document: str, kind: str) -> dict[str, tuple[str, ...]]:
    """All five complete, unique NO_VERIFICABLE rows or fail closed."""
    if kind not in ("matrix", "contrast"):
        raise ValueError("UNKNOWN: unknown source kind")
    found: dict[str, tuple[str, ...]] = {}
    for identifier in GAPS:
        prefix = "| " + identifier + (" ·" if kind == "matrix" else " |")
        matches = [line for line in document.splitlines()
                   if line.startswith(prefix)]
        if len(matches) != 1:
            raise ValueError("UNKNOWN: missing or ambiguous " + identifier)
        cells = tuple(cell.strip() for cell in matches[0].strip("|").split("|"))
        if len(cells) != 5:
            raise ValueError("UNKNOWN: incomplete row " + identifier)
        if kind == "matrix":
            if (cells[2] != "NO_VERIFICABLE" or "README.md" not in cells[0]
                    or "Estado operativo: UNKNOWN" not in cells[3]
                    or "Contraste #292" not in cells[3]):
                raise ValueError("UNKNOWN: unverified matrix " + identifier)
        elif (cells[0] != identifier or cells[3] != "NO_VERIFICABLE"
              or identifier not in cells[4]
              or "Falta evidencia específica" not in cells[4]):
            raise ValueError("UNKNOWN: unverified contrast " + identifier)
        expected = "Roadmap y fuentes de verdad — " + ": ".join(GAPS[identifier])
        if expected not in cells[1]:
            raise ValueError("UNKNOWN: changed requirement " + identifier)
        found[identifier] = cells
    return found


def readme_section(document: str) -> str:
    marker = "## Roadmap y fuentes de verdad"
    if document.splitlines().count(marker) != 1:
        return ""
    section = document.split(marker, 1)[1].split("\n## ", 1)[0]
    return section


def active_decision(document: str, identifier: str) -> bool:
    try:
        entries = json.loads(document)["decisions"]
        matches = [entry for entry in entries if entry.get("id") == identifier]
        return (len(matches) == 1 and matches[0].get("status") == "active")
    except (ValueError, TypeError, KeyError, AttributeError):
        return False


def classify(identifier: str, source: dict[str, str]) -> str:
    """Only local source consistency; operational truth remains UNKNOWN."""
    if identifier not in GAPS or not all(source.get(p) for p in SOURCES):
        return UNKNOWN
    try:
        matrix, contrast = rows(source[MATRIX], "matrix"), rows(
            source[CONTRAST], "contrast")
        section = readme_section(source[README])
        if not section or not active_decision(source["decisiones.yml"], "D-061"):
            return UNKNOWN
        title = GAPS[identifier][0]
        matching = [line for line in section.splitlines()
                    if line.startswith("- **" + title + ":**")]
        if len(matching) != 1 or not all(
                ref in matching[0] for ref in REFERENCES[identifier]):
            return UNKNOWN
        if not all(ref in matrix[identifier][1]
                   for ref in GAPS[identifier]):
            return UNKNOWN
        if not all(ref in contrast[identifier][1]
                   for ref in GAPS[identifier]):
            return UNKNOWN
        if "no demuestra un estado operativo" not in contrast[identifier][4]:
            return UNKNOWN
        if "No inferir instalación" not in source[README]:
            return UNKNOWN

        if identifier == "README-09-01":
            if ("D-061" not in source["AGENTES.md"]
                    or "readiness #134" not in matching[0]):
                return UNKNOWN
        elif identifier == "README-09-02":
            workflow = source[".github/workflows/coordinacion.yml"]
            if "pull_request:" not in workflow or "issues:" not in workflow:
                return UNKNOWN
        elif identifier == "README-09-03":
            if (not active_decision(source["decisiones.yml"], "D-060")
                    or json.loads(source["datos.yml"]).get("phase") != "construccion"
                    or "fuente de verdad" not in source["AGENTES.md"].lower()):
                return UNKNOWN
        elif identifier == "README-09-04":
            release = re.search(
                r"\[v(\d+\.\d+\.\d+)\]\(https://github\.com/"
                r"pl0n3r/AutoFactory/releases/tag/v\1\)", source[README])
            if not release or not re.search(
                    rf"(?m)^## {re.escape(release.group(1))} — ",
                    source["CHANGELOG.md"]):
                return UNKNOWN
        elif identifier == "README-09-05":
            if ("PLAN-AGENTES.md" not in source["AGENTES.md"]
                    or "pl0n3r/factory/.github/workflows/coordinacion.yml@v1"
                    not in source[".github/workflows/coordinacion.yml"]):
                return UNKNOWN
    except (ValueError, TypeError, KeyError, AttributeError):
        return UNKNOWN
    return LOCAL


def operational(_identifier: object, _snapshot: object = None) -> str:
    """No offline evidence proves GitHub state, release or installed extension."""
    return UNKNOWN


class BrechasAutofactory28Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: one runnable/sourced contract for each complete matrix row."""
        source = read_sources()
        self.assertEqual(set(rows(source[MATRIX], "matrix")), set(GAPS))
        self.assertEqual(set(rows(source[CONTRAST], "contrast")), set(GAPS))
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(LOCAL, classify(identifier, source))
                self.assertEqual(UNKNOWN, operational(identifier, source))

    def test_falla_cerrado(self) -> None:
        """AC-02: absent/ambiguous/counterfeit evidence cannot pass."""
        source = read_sources()
        for path, kind in ((MATRIX, "matrix"), (CONTRAST, "contrast")):
            for identifier in GAPS:
                prefix = "| " + identifier + (" ·" if kind == "matrix" else " |")
                row = next(x for x in source[path].splitlines()
                           if x.startswith(prefix))
                mutations = (source[path].replace(row, "", 1),
                             source[path] + "\n" + row,
                             source[path].replace(
                                 row, row.replace("NO_VERIFICABLE", "CUBIERTO"), 1))
                for candidate in mutations:
                    with self.subTest(path=path, identifier=identifier):
                        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                            rows(candidate, kind)
        for identifier in GAPS:
            broken = dict(source)
            original = REFERENCES[identifier][0]
            target = next(line for line in source[README].splitlines()
                          if line.startswith(
                              "- **" + GAPS[identifier][0] + ":**"))
            self.assertIn(original, target)
            broken[README] = source[README].replace(
                target, target.replace(original, "broken", 1), 1)
            with self.subTest(identifier=identifier):
                self.assertEqual(UNKNOWN, classify(identifier, broken))
                self.assertEqual(UNKNOWN, classify(identifier, {}))
        wrong_decisions = dict(source)
        decision_tree = json.loads(source["decisiones.yml"])
        updated = [decision for decision in decision_tree["decisions"]
                   if decision.get("id") == "D-061"]
        self.assertEqual(1, len(updated))
        updated[0]["status"] = "inactive"
        wrong_decisions["decisiones.yml"] = json.dumps(decision_tree)
        self.assertEqual(UNKNOWN, classify("README-09-03", wrong_decisions))
        for path, original, replacement, identifier in (
            ("datos.yml", '"phase": "construccion"', '"phase": "live"',
             "README-09-03"),
            ("CHANGELOG.md", "## 1.7.38 —", "## stale —",
             "README-09-04"),
            (".github/workflows/coordinacion.yml",
             "pl0n3r/factory/.github/workflows/coordinacion.yml@v1",
             "unknown-coordination", "README-09-05"),
        ):
            if original in source[path]:
                broken = dict(source)
                broken[path] = broken[path].replace(original, replacement, 1)
                self.assertEqual(UNKNOWN, classify(identifier, broken))

    def test_sin_datos_reales(self) -> None:
        """AC-03: no network clients, shell, tokens or real user data."""
        tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
        imports = {alias.name.split(".")[0] for node in ast.walk(tree)
                   if isinstance(node, ast.Import) for alias in node.names}
        imports |= {node.module.split(".")[0] for node in ast.walk(tree)
                    if isinstance(node, ast.ImportFrom) and node.module}
        self.assertFalse(imports & {
            "socket", "urllib", "requests", "http", "httpx", "subprocess",
        })
        self.assertTrue(set(SOURCES) <= {
            MATRIX, CONTRAST, README, "AGENTES.md", "decisiones.yml",
            "datos.yml", "CHANGELOG.md", ".github/workflows/coordinacion.yml",
        })
        self.assertEqual(UNKNOWN, operational("README-09-03", {"token": True}))

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: static links never attest live GitHub or release readiness."""
        source = read_sources()
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(LOCAL, classify(identifier, source))
                for counterfeit in (
                    None, {}, True, {"issues": "closed", "prs": "merged"},
                    {"ci": "success", "sha": "placeholder"},
                    {"release": "published", "installed": True},
                    {"bridge": "ready", "legal_gate": True},
                ):
                    self.assertEqual(UNKNOWN, operational(identifier, counterfeit))


if __name__ == "__main__":
    unittest.main()
