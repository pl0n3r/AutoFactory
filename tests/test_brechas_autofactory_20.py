#!/usr/bin/env python3
"""AutoFactory #327: five offline coverage regressions, never live attestation.

The existing Node ac20-ac23 scenarios run with injected browser and fetch fakes.
Passing them neither proves a Chrome/Safari installation nor activates D-061.
"""
from __future__ import annotations

from functools import lru_cache
import os
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
README = ROOT / "README.md"
CONTRAST = ROOT / "docs/contraste-af_readme.md"
NODE_SUITE = ROOT / "test-factory-control-local-commands.cjs"
PYTHON_SUITE = ROOT / "tests/test_factory_control_local_commands.py"
SOURCE = ROOT / "factory-control-local-commands.js"
GAPS = {
    "PROTO-28": ("ac20", "Propagación de STOP frente a pestañas no disponibles"),
    "PROTO-29": ("ac21", "Timeout de pestañas suspendidas"),
    "PROTO-30": ("ac22", "Revocación del permiso de host durante ACK"),
    "PROTO-31": ("ac23", "Límite de consulta de pestañas"),
}
ROWS = (*GAPS, "README-01-01")
UNKNOWN = "UNKNOWN"
OFFLINE_PASS = "OFFLINE_PASS"
NODE_SUCCESS = "Local commands pure contract: PASS"


def matrix_rows(document: str) -> dict[str, list[str]]:
    """Missing, duplicated, or malformed rows are explicitly UNKNOWN."""
    found = {}
    for identifier in ROWS:
        matches = [line for line in document.splitlines()
                   if line.startswith(f"| {identifier} ·")]
        if len(matches) != 1:
            raise ValueError(f"UNKNOWN: missing or ambiguous {identifier}")
        cells = [cell.strip() for cell in matches[0].strip("|").split("|")]
        if len(cells) != 5 or cells[2] != "NO_VERIFICABLE":
            raise ValueError(f"UNKNOWN: invalid coverage row {identifier}")
        found[identifier] = cells
    return found


def classify_node(exit_code: object, output: object) -> str:
    """Only a terminal, exact offline success marker counts as tested."""
    if type(exit_code) is not int or exit_code != 0 or output != NODE_SUCCESS:
        return UNKNOWN
    return OFFLINE_PASS


@lru_cache(maxsize=4)
def execute_case(case: str) -> str:
    """Run a real assertion-based JS scenario, not a simulated PASS string."""
    if case not in {item[0] for item in GAPS.values()}:
        return UNKNOWN
    node = shutil.which("node")
    if node is None or not NODE_SUITE.is_file():
        return UNKNOWN
    # No credentials, home directory, proxy settings or browser environment.
    env = {"PATH": os.path.dirname(node) + os.pathsep + "/usr/bin:/bin",
           "CI": "true"}
    try:
        result = subprocess.run(
            [node, str(NODE_SUITE), case], cwd=ROOT, env=env,
            capture_output=True, text=True, check=False, timeout=35,
        )
    except (OSError, subprocess.TimeoutExpired):
        return UNKNOWN
    # Do not echo error output: failed fixtures must never expose secrets.
    return classify_node(result.returncode, result.stdout.strip())


def operational_evidence(identifier: str, evidence: object = None) -> str:
    """Static README, fake browser APIs, and CI success never prove live."""
    return UNKNOWN


class BrechasAutofactory20Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: four executed Node assertions and README's distinct gap."""
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        self.assertEqual(set(rows), set(ROWS))
        for path in (NODE_SUITE, PYTHON_SUITE, SOURCE, README, CONTRAST):
            self.assertTrue(path.is_file(), path.name)
        node_source = NODE_SUITE.read_text(encoding="utf-8")
        for identifier, (case, description) in GAPS.items():
            with self.subTest(identifier=identifier):
                row = rows[identifier]
                self.assertIn(description, row[1])
                self.assertIn("factory-control-local-commands.js", row[3])
                self.assertIn("tests/test_factory_control_local_commands.py", row[3])
                self.assertIn("Contraste #290", row[3])
                self.assertIn(f"async function {case}()", node_source)
                self.assertIn(f'def test_{case}_', PYTHON_SUITE.read_text(encoding="utf-8"))
                self.assertEqual(execute_case(case), OFFLINE_PASS,
                                 identifier + ": JS scenario did not pass")
        readme_row = rows["README-01-01"]
        self.assertIn("Operational Cockpit", readme_row[1])
        self.assertIn("Falta evidencia correlacionada", readme_row[3])
        readme = README.read_text(encoding="utf-8")
        self.assertIn("## Operational Cockpit", readme)
        self.assertIn("Validate sobre main", readme)
        self.assertIn("éxito en CI no acredita instalación Chrome/Safari", readme)
        contrast = CONTRAST.read_text(encoding="utf-8")
        self.assertIn("| README-01-01 |", contrast)
        self.assertIn("NO_VERIFICABLE", contrast)
        self.assertEqual(operational_evidence("README-01-01", readme), UNKNOWN)

    def test_falla_cerrado(self) -> None:
        """AC-02: reject missing/duplicated rows and ambiguous Node results."""
        original = MATRIX.read_text(encoding="utf-8")
        rows = matrix_rows(original)
        for identifier in ROWS:
            line = next(line for line in original.splitlines()
                        if line.startswith(f"| {identifier} ·"))
            for invalid in (original.replace(line + "\n", "", 1),
                            original + "\n" + line,
                            original.replace(line, f"| {identifier} · broken |", 1)):
                with self.subTest(identifier=identifier), self.assertRaisesRegex(
                    ValueError, "UNKNOWN"
                ):
                    matrix_rows(invalid)
            self.assertEqual(rows[identifier][2], "NO_VERIFICABLE")
        for exit_code, text in ((1, NODE_SUCCESS), (0, ""), (0, "PASS"),
                                (None, NODE_SUCCESS), (True, NODE_SUCCESS),
                                (0, NODE_SUCCESS + " fake")):
            self.assertEqual(classify_node(exit_code, text), UNKNOWN)
        self.assertEqual(execute_case("not-a-scenario"), UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        """AC-03: only fake Node browser adapters, no user or provider data."""
        node_source = NODE_SUITE.read_text(encoding="utf-8")
        for case in ("ac20", "ac21", "ac22", "ac23"):
            self.assertIn(f"async function {case}()", node_source)
            self.assertEqual(execute_case(case), OFFLINE_PASS)
        # Published success is a fixed marker, not stdout with raw payloads.
        for sensitive in ("Bearer ", "Authorization:", "access_token",
                          "conversation_id", "email@", "session_cookie", "API_KEY"):
            self.assertNotIn(sensitive, NODE_SUCCESS)
        self.assertEqual(operational_evidence("PROTO-28", {
            "synthetic": True, "ci": "success", "network": False,
        }), UNKNOWN)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: no offline assertion promotes an operational claim."""
        rows = matrix_rows(MATRIX.read_text(encoding="utf-8"))
        for identifier in ROWS:
            with self.subTest(identifier=identifier):
                self.assertIn("UNKNOWN", rows[identifier][3])
                for claimed in (None, {}, True, {"ci": "success"},
                                {"node": OFFLINE_PASS},
                                {"installed": True, "smoke": "claimed"},
                                {"runtime": "claimed", "consent": "claimed"}):
                    self.assertEqual(operational_evidence(identifier, claimed), UNKNOWN)
        self.assertEqual(classify_node(0, NODE_SUCCESS), OFFLINE_PASS)
        self.assertEqual(operational_evidence("PROTO-31", OFFLINE_PASS), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
