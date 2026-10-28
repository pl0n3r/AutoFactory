#!/usr/bin/env python3
"""AutoFactory #337: five README gaps, checked offline and fail-closed.

Documentation is not evidence of live FactoryRunner execution, cross-repository
integration, an installed Chrome extension or browser permissions.
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
SOURCES = (MATRIX, CONTRAST, README, "AGENTES.md", "decisiones.yml", "manifest.json")
GAPS = {
    "README-11-03": (
        "Mapa de la fábrica — FactoryRunner — execution plane; ejecuta órdenes ya gobernadas y reporta evidencia",
        "- **FactoryRunner** — execution plane; ejecuta órdenes ya gobernadas y reporta evidencia.",
    ),
    "README-11-04": (
        "Mapa de la fábrica — Condor / GrindFlow / BRVTAL — productos construidos por la fábrica",
        "- **Condor / GrindFlow / BRVTAL** — productos construidos por la fábrica.",
    ),
    "README-11-05": (
        "Mapa de la fábrica — AutoFactory — herramienta local/manual del dueño para continuidad de chats",
        "- **AutoFactory** — herramienta local/manual del dueño para continuidad de chats.",
    ),
    "README-12-01": (
        "Instalación y uso — Abre chrome://extensions",
        "1. Abre " + chr(96) + "chrome://extensions" + chr(96) + ".",
    ),
    "README-12-02": (
        "Instalación y uso — Activa Modo de desarrollador",
        "2. Activa **Modo de desarrollador**.",
    ),
}


def read_sources() -> dict[str, str]:
    """Use local checkout files only, never external APIs or real browsers."""
    return {path: (ROOT / path).read_text(encoding="utf-8") for path in SOURCES}


def rows(document: str, kind: str) -> dict[str, tuple[str, ...]]:
    """Reject missing, duplicate, stale and truncated evidence as UNKNOWN."""
    if kind not in ("matrix", "contrast"):
        raise ValueError("UNKNOWN: invalid audit source")
    found = {}
    for identifier, (expected, _) in GAPS.items():
        prefix = "| " + identifier + (" ·" if kind == "matrix" else " |")
        matches = [line for line in document.splitlines() if line.startswith(prefix)]
        if len(matches) != 1:
            raise ValueError("UNKNOWN: missing or ambiguous " + identifier)
        cells = tuple(cell.strip() for cell in matches[0].strip("|").split("|"))
        if len(cells) != 5 or not cells[0].startswith(identifier):
            raise ValueError("UNKNOWN: incomplete " + identifier)
        if kind == "matrix":
            if (cells[2] != "NO_VERIFICABLE" or "README.md" not in cells[0]
                    or expected not in cells[1] or "Contraste #292" not in cells[3]
                    or "Estado operativo: UNKNOWN" not in cells[3]
                    or "Falta evidencia específica" not in cells[3]):
                raise ValueError("UNKNOWN: invalid matrix evidence " + identifier)
        elif (cells[0] != identifier or cells[3] != "NO_VERIFICABLE"
              or expected not in cells[1] or "Falta evidencia específica" not in cells[4]
              or identifier not in cells[4]):
            raise ValueError("UNKNOWN: invalid contrast evidence " + identifier)
        found[identifier] = cells
    return found


def section(document: str, heading: str) -> str:
    lines = document.splitlines()
    starts = [i for i, line in enumerate(lines) if line == heading]
    if len(starts) != 1:
        return ""
    start = starts[0] + 1
    end = next((i for i in range(start, len(lines))
                if lines[i].startswith("## ")), len(lines))
    return "\n".join(lines[start:end])


def active_decision(document: str, identifier: str) -> bool:
    try:
        entries = json.loads(document)["decisions"]
        matches = [d for d in entries if isinstance(d, dict)
                   and d.get("id") == identifier]
        return len(matches) == 1 and matches[0].get("status") == "active"
    except (TypeError, ValueError, KeyError, AttributeError):
        return False


def classify(identifier: str, sources: dict[str, str]) -> str:
    """Only attest source consistency; operational evidence stays UNKNOWN."""
    if identifier not in GAPS or not all(sources.get(path) for path in SOURCES):
        return UNKNOWN
    try:
        matrix = rows(sources[MATRIX], "matrix")
        contrast = rows(sources[CONTRAST], "contrast")
        manifest = json.loads(sources["manifest.json"])
    except (TypeError, ValueError, KeyError, AttributeError):
        return UNKNOWN
    if (identifier not in matrix or identifier not in contrast
            or not active_decision(sources["decisiones.yml"], "D-061")
            or manifest.get("manifest_version") != 3
            or manifest.get("host_permissions") != ["https://chatgpt.com/*"]
            or "no servidor web" not in sources["AGENTES.md"]
            or "D-061" not in sources["AGENTES.md"]):
        return UNKNOWN
    heading = "## Mapa de la fábrica" if identifier.startswith("README-11") else "## Instalación y uso"
    block = section(sources[README], heading)
    expected = GAPS[identifier][1]
    if not block or block.splitlines().count(expected) != 1:
        return UNKNOWN
    if identifier.startswith("README-11"):
        # A responsibility map is not a trans-repo runtime integration test.
        if ("AutoFactory no se fusiona con FactoryRunner" not in block
                or "FactoryRunner" not in block or "ControlBot" not in block):
            return UNKNOWN
    else:
        # A user-facing instruction cannot certify a manual Chrome smoke.
        if ("### Instalar en Chrome" not in block
                or "3. Pulsa **Cargar descomprimida**." not in block):
            return UNKNOWN
    return LOCAL


def operational_evidence(_identifier: object, _claim: object = None) -> str:
    """Never infer browser installation, cross-repo execution, or live status."""
    return UNKNOWN


class BrechasAutofactory30Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: five independent complete row contracts."""
        sources = read_sources()
        self.assertEqual(set(GAPS), set(rows(sources[MATRIX], "matrix")))
        self.assertEqual(set(GAPS), set(rows(sources[CONTRAST], "contrast")))
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(LOCAL, classify(identifier, sources))
                self.assertEqual(UNKNOWN, operational_evidence(identifier))

    def test_falla_cerrado(self) -> None:
        """AC-02: absent, altered, ambiguous or counterfeit evidence fails."""
        sources = read_sources()
        for path, kind in ((MATRIX, "matrix"), (CONTRAST, "contrast")):
            for identifier in GAPS:
                prefix = "| " + identifier + (" ·" if kind == "matrix" else " |")
                row = next(line for line in sources[path].splitlines()
                           if line.startswith(prefix))
                for altered in (
                    sources[path].replace(row, "", 1),
                    sources[path] + "\n" + row,
                    sources[path].replace(row, row.replace("NO_VERIFICABLE", "CUBIERTO", 1), 1),
                    sources[path].replace(row, row.split(" | ")[0] + " |", 1),
                ):
                    with self.subTest(path=path, identifier=identifier):
                        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                            rows(altered, kind)
        for identifier, (_, line) in GAPS.items():
            broken = dict(sources)
            broken[README] = sources[README].replace(line, "Texto no corroborado", 1)
            with self.subTest(identifier=identifier):
                self.assertEqual(UNKNOWN, classify(identifier, broken))
                self.assertEqual(UNKNOWN, classify(identifier, {}))
        for identifier in GAPS:
            self.assertEqual(UNKNOWN, classify(identifier, {**sources, "manifest.json": "{}"}))
            self.assertEqual(UNKNOWN, classify(identifier, {**sources, "AGENTES.md": ""}))
        decisions = json.loads(sources["decisiones.yml"])
        for item in decisions["decisions"]:
            if item.get("id") == "D-061":
                item["status"] = "revoked"
        self.assertEqual(UNKNOWN, classify("README-11-05", {
            **sources, "decisiones.yml": json.dumps(decisions),
        }))

    def test_sin_datos_reales(self) -> None:
        """AC-03: no network, browser clients, secrets or personal datasets."""
        tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
        imports = {a.name.split(".")[0] for n in ast.walk(tree)
                   if isinstance(n, ast.Import) for a in n.names}
        imports |= {n.module.split(".")[0] for n in ast.walk(tree)
                    if isinstance(n, ast.ImportFrom) and n.module}
        self.assertFalse(imports & {"socket", "urllib", "requests", "http", "httpx",
                                    "subprocess", "selenium", "playwright"})
        self.assertEqual(set(SOURCES), {MATRIX, CONTRAST, README, "AGENTES.md",
                                        "decisiones.yml", "manifest.json"})
        self.assertEqual(UNKNOWN, operational_evidence("README-12-01", {"browser": "claimed"}))
        self.assertEqual(UNKNOWN, operational_evidence("README-11-04", {"production": True}))

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: never elevate unverified states on the strength of a fixture."""
        sources = read_sources()
        for identifier in GAPS:
            with self.subTest(identifier=identifier):
                self.assertEqual(LOCAL, classify(identifier, sources))
                for fabricated in (None, {}, True, {"ci": "success"},
                                   {"factory_runner": "executed"},
                                   {"products": ["Condor", "GrindFlow", "BRVTAL"]},
                                   {"chrome": "installed", "developer_mode": True},
                                   {"owner": "approved", "smoke": "success"}):
                    self.assertEqual(UNKNOWN, operational_evidence(identifier, fabricated))
        self.assertEqual(UNKNOWN, classify("README-12-99", sources))


if __name__ == "__main__":
    unittest.main()
