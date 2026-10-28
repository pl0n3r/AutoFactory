#!/usr/bin/env python3
"""AutoFactory #328: five README gap contracts, offline only.

Checks synthetic release/activation/transport/recovery behavior. Passing local
tests is not an installed Chrome/Safari smoke, an authorized pairing, or a
production attestation. The coverage matrix intentionally remains unchanged.
"""
from __future__ import annotations

from functools import lru_cache
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
CONTRAST = ROOT / "docs/contraste-af_readme.md"
README = ROOT / "README.md"
CHANGELOG = ROOT / "CHANGELOG.md"
IDS = (
    "README-01-02", "README-01-03", "README-01-04",
    "README-01-05", "README-02-01",
)
UNKNOWN = "UNKNOWN"
OFFLINE_PASS = "OFFLINE_PASS"
# Every README row has its own executable or explicitly limited gap case.
# These Node scripts use injected adapters and synthetic receipts, not real I/O.
CASES = {
    "README-01-02": (
        "test-release-evidence.cjs",
        "Release evidence gate: fail-closed contract verified",
    ),
    "README-01-03": (
        "test-factory-control-activation.cjs",
        "factory-control activation preflight: ok",
    ),
    "README-01-04": (
        "test-factory-control-transport.cjs",
        "factory-control transport contract: ok",
    ),
    "README-01-05": (
        "test-release-evidence.cjs",
        "Release evidence gate: fail-closed contract verified",
    ),
    "README-02-01": (
        "test-adaptive-recovery.cjs",
        "adaptive recovery: configuration, confidence, observation and safety invariants pass",
    ),
}
EXPECTATIONS = {
    "README-01-02": "Operational Cockpit — Paquetes: Releases oficiales",
    "README-01-03": "Operational Cockpit — Orquestador: ControlBot",
    "README-01-04": "Operational Cockpit — Este enlace no activa pairing ni tráfico real",
    "README-01-05": "Operational Cockpit — Instalación Safari: #122",
    "README-02-01": "Estado de la versión publicada — La versión 1.7.38",
}


def matrix_rows(document: str) -> dict[str, tuple[str, ...]]:
    """No row, duplicate, false promotion or malformed evidence -> UNKNOWN."""
    found: dict[str, tuple[str, ...]] = {}
    for line in document.splitlines():
        if not line.startswith("| README-"):
            continue
        first = line.split("|", 2)[1].strip()
        identifier = first.split(" · ", 1)[0]
        if identifier not in IDS:
            continue
        cells = tuple(c.strip() for c in line.strip().strip("|").split("|"))
        if (identifier in found or len(cells) != 5
                or cells[0] != identifier + " · README.md"
                or not cells[1].startswith(EXPECTATIONS[identifier])
                or cells[2] != "NO_VERIFICABLE"
                or "Contraste #292:" not in cells[3]
                or "Estado operativo: UNKNOWN" not in cells[3]
                or identifier not in cells[3]
                or not all(cells)):
            raise ValueError("UNKNOWN: invalid or duplicated matrix " + identifier)
        found[identifier] = cells
    if set(found) != set(IDS):
        raise ValueError("UNKNOWN: missing matrix " + ",".join(sorted(set(IDS) - set(found))))
    return found


def contrast_rows(document: str) -> dict[str, tuple[str, ...]]:
    """Read the actual #292 verdict, never infer release/smoke from a badge."""
    if document.count("## Veredictos por fila") != 1:
        raise ValueError("UNKNOWN: contrast section missing or duplicated")
    if document.count("## Límites y continuación") != 1:
        raise ValueError("UNKNOWN: contrast limits missing or duplicated")
    section = document.split("## Veredictos por fila", 1)[1].split(
        "## Límites y continuación", 1
    )[0]
    found: dict[str, tuple[str, ...]] = {}
    for line in section.splitlines():
        if not line.startswith("| README-"):
            continue
        cells = tuple(c.strip() for c in line.strip().strip("|").split("|"))
        identifier = cells[0] if cells else ""
        if identifier not in IDS:
            continue
        if (identifier in found or len(cells) != 5
                or not cells[1].startswith("README.md — " + EXPECTATIONS[identifier])
                or cells[3] != "NO_VERIFICABLE"
                or identifier not in cells[4]
                or "Falta" not in cells[4]):
            raise ValueError("UNKNOWN: invalid or duplicated contrast " + identifier)
        found[identifier] = cells
    if set(found) != set(IDS):
        raise ValueError("UNKNOWN: missing contrast " + ",".join(sorted(set(IDS) - set(found))))
    return found


def classify_local(code: object, stdout: object, stderr: object, expected: str) -> str:
    """Only an exact terminal marker from a successful offline test counts."""
    if (type(code) is not int or code != 0 or type(stdout) is not str
            or type(stderr) is not str or stderr.strip()
            or stdout.strip().splitlines()[-1:] != [expected]):
        return UNKNOWN
    return OFFLINE_PASS


@lru_cache(maxsize=5)
def run_case(identifier: str) -> str:
    if identifier not in CASES:
        return UNKNOWN
    script, marker = CASES[identifier]
    node = shutil.which("node")
    if node is None or not (ROOT / script).is_file():
        return UNKNOWN
    # No inherited home, auth, proxy, browser profile or user content.
    env = {"PATH": os.path.dirname(node) + os.pathsep + "/usr/bin:/bin",
           "CI": "true"}
    try:
        result = subprocess.run(
            [node, str(ROOT / script)], cwd=ROOT, env=env,
            capture_output=True, text=True, check=False, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return UNKNOWN
    # Do not expose output: synthetic failing cases may contain private strings.
    return classify_local(result.returncode, result.stdout, result.stderr, marker)


def operational_evidence(identifier: object, evidence: object = None) -> str:
    """Offline tests, release links and self-reported smoke never attest live."""
    return UNKNOWN


def release_candidate_offline() -> bool:
    """Execute the existing parity regression rather than trust version text."""
    cmd = [sys.executable, "-m", "unittest", "tests.test_release_candidate_1_7_38"]
    try:
        result = subprocess.run(
            cmd, cwd=ROOT, env={"PATH": "/usr/bin:/bin", "CI": "true"},
            capture_output=True, text=True, check=False, timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and "OK" in result.stderr.splitlines()


class BrechasAutofactory21Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: five row-specific cases, real fake-adapter execution."""
        matrix = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        report = contrast_rows(CONTRAST.read_text(encoding="utf-8"))
        self.assertEqual(set(matrix), set(IDS))
        self.assertEqual(set(report), set(IDS))
        readme = README.read_text(encoding="utf-8")
        cockpit = readme.split("## Operational Cockpit", 1)[1].split("\n## ", 1)[0]
        for identifier in IDS:
            with self.subTest(identifier=identifier):
                self.assertIn(EXPECTATIONS[identifier], matrix[identifier][1])
                self.assertIn("UNKNOWN", matrix[identifier][3])
                self.assertEqual(report[identifier][3], "NO_VERIFICABLE")
                script, _ = CASES[identifier]
                self.assertTrue((ROOT / script).is_file(), identifier)
                self.assertEqual(run_case(identifier), OFFLINE_PASS, identifier)
                self.assertEqual(operational_evidence(identifier, OFFLINE_PASS), UNKNOWN)
        self.assertIn("Releases oficiales", cockpit)
        self.assertIn("releases/tag/v1.7.38", cockpit)
        self.assertIn("[ControlBot, consola privada]", cockpit)
        self.assertIn("Este enlace no activa pairing ni tráfico real", cockpit)
        self.assertIn("#122 — smoke real pendiente", cockpit)
        published = readme.split("## Estado de la versión publicada", 1)[1].split("\n## ", 1)[0]
        for version in ("1.7.38", "1.7.37", "1.7.36"):
            self.assertIn(version, published)
            self.assertIn("## " + version + " — ", CHANGELOG.read_text(encoding="utf-8"))
        self.assertIn("puerta legal D-061", published)
        self.assertTrue(release_candidate_offline(), "version parity regression failed")
        for name in (
            "manifest.json", "package.json",
            "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json",
        ):
            with self.subTest(manifest=name):
                doc = json.loads((ROOT / name).read_text(encoding="utf-8"))
                self.assertEqual(doc["version"], "1.7.38")

    def test_falla_cerrado(self) -> None:
        """AC-02: missing, duplicate, manipulated rows and forged successes."""
        document = MATRIX.read_text(encoding="utf-8")
        report = CONTRAST.read_text(encoding="utf-8")
        self.assertEqual(set(matrix_rows(document)), set(IDS))
        for identifier in IDS:
            row = next(x for x in document.splitlines()
                       if x.startswith("| " + identifier + " ·"))
            altered = (
                document.replace(row + "\n", "", 1),
                document + "\n" + row,
                document.replace(row, row.replace("NO_VERIFICABLE", "CUBIERTO"), 1),
                document.replace(row, row.replace("Estado operativo: UNKNOWN", "GREEN"), 1),
            )
            for candidate in altered:
                with self.subTest(identifier=identifier), self.assertRaisesRegex(
                    ValueError, "UNKNOWN"
                ):
                    matrix_rows(candidate)
            contrast_line = next(x for x in report.splitlines()
                                 if x.startswith("| " + identifier + " |"))
            for candidate in (
                report.replace(contrast_line + "\n", "", 1),
                report.replace(contrast_line, contrast_line + "\n" + contrast_line, 1),
                report.replace(contrast_line, contrast_line.replace("NO_VERIFICABLE", "CUBIERTO"), 1),
            ):
                with self.subTest(identifier=identifier), self.assertRaisesRegex(
                    ValueError, "UNKNOWN"
                ):
                    contrast_rows(candidate)
        marker = CASES["README-01-02"][1]
        for code, output, err in (
            (1, marker, ""), (0, "PASS", ""), (0, "", ""),
            (None, marker, ""), (True, marker, ""), (0, marker, "failure"),
            (0, marker + "\nFAKE", ""),
        ):
            self.assertEqual(classify_local(code, output, err, marker), UNKNOWN)
        self.assertEqual(run_case("README-99-99"), UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        """AC-03: local fixtures, no actual devices, credentials or network."""
        for script, _ in CASES.values():
            self.assertTrue(script.startswith("test-") and script.endswith(".cjs"))
            self.assertTrue((ROOT / script).is_file())
        self.assertEqual(set(IDS), set(CASES))
        for identifier in IDS:
            self.assertEqual(run_case(identifier), OFFLINE_PASS)
        synthetic = {"release": "v1.7.38", "ci": "success",
                     "chrome_smoke": "synthetic", "safari_smoke": None,
                     "pairing": "not_activated", "network": False}
        self.assertEqual(operational_evidence("README-01-05", synthetic), UNKNOWN)
        self.assertNotIn("credentials", str(CASES).lower())
        self.assertNotIn("authorization", str(CASES).lower())

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: link, tag, tests or fake receipts never become installed GREEN."""
        matrix = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        report = contrast_rows(CONTRAST.read_text(encoding="utf-8"))
        for identifier in IDS:
            with self.subTest(identifier=identifier):
                self.assertEqual(matrix[identifier][2], "NO_VERIFICABLE")
                self.assertEqual(report[identifier][3], "NO_VERIFICABLE")
                for claimed in (None, {}, True, {"ci": "success"},
                                {"installed": True}, {"release": "v1.7.38"},
                                {"smoke": "claimed"}, {"paired": True},
                                {"network": "claimed"}, OFFLINE_PASS):
                    self.assertEqual(operational_evidence(identifier, claimed), UNKNOWN)
        self.assertEqual(classify_local(0, CASES["README-01-02"][1], "",
                                        CASES["README-01-02"][1]), OFFLINE_PASS)
        self.assertEqual(operational_evidence("README-01-02", OFFLINE_PASS), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
