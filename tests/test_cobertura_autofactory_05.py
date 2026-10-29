#!/usr/bin/env python3
"""AutoFactory #395: execute genuine Node contracts with synthetic dependencies.

These are *local* contracts, not evidence of browser installation, transport,
ControlBot authorization, production, or exact-SHA GitHub CI success. The
coverage matrix is read-only and retains its NO_VERIFICABLE status.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
UNKNOWN = "UNKNOWN"
OFFLINE = "LOCAL_NODE_BEHAVIOR"


@dataclass(frozen=True)
class Case:
    row: str
    source: str
    script: str
    args: tuple[str, ...]
    receipt: str


CASES = (
    Case("PROTO-13", "factory-control-response-consent.js",
         "test-factory-control-response-consent.cjs", (),
         "factory-control response consent: ok"),
    Case("PROTO-14", "factory-control-pairing.js",
         "test-factory-control-pairing.cjs", (),
         "pairing-audit AC-04: ok"),
    Case("PROTO-15", "factory-control-pairing.js",
         "test-factory-control-pairing.cjs", (),
         "factory-control pairing contract: ok"),
    Case("PROTO-16", "factory-control-instance-transport.js",
         "test-factory-control-instance-transport.cjs", (),
         "factory-control local-agent transport boundary: ok"),
    Case("PROTO-17", "factory-control-instance-transport.js",
         "test-factory-control-instance-transport.cjs", (),
         "factory-control local-agent transport boundary: ok"),
    Case("PROTO-18", "factory-control-runtime.js",
         "test-factory-control-runtime.cjs", ("all",),
         "factory-control runtime lifecycle: ok"),
    Case("PROTO-19", "factory-control-account-state.js",
         "test-factory-control-account-state.cjs", (),
         "factory-control account state contract: ok"),
    Case("PROTO-20", "factory-control-activation.js",
         "test-factory-control-activation.cjs", (),
         "factory-control activation preflight: ok"),
    Case("PROTO-21", "factory-control-heartbeat.js",
         "test-factory-control-heartbeat.cjs", (),
         "heartbeat-presence AC-03: ok"),
    Case("PROTO-22", "factory-control-account-state-freshness.js",
         "test-factory-control-account-state-freshness.cjs", ("AC-02",),
         "AC-02: ok"),
    Case("PROTO-23", "factory-control-heartbeat.js",
         "test-factory-control-heartbeat.cjs", (),
         "Factory Control heartbeat: consent, 60s cadence, revocation and safe failures pass"),
    Case("PROTO-24", "factory-control-account-state.js",
         "test-factory-control-account-state.cjs", (),
         "account-state AC-03: ok"),
    Case("PROTO-25", "factory-control-local-publisher.js",
         "test-factory-control-local-publisher.cjs", ("ac02",),
         "Factory local publisher ac02: PASS"),
    Case("PROTO-26", "factory-control-local-commands.js",
         "test-factory-control-local-commands.cjs", ("ac01",),
         "Local commands pure contract: PASS"),
    Case("PROTO-27", "factory-control-local-commands.js",
         "test-factory-control-local-commands.cjs", ("ac19",),
         "Local commands pure contract: PASS"),
    Case("PROTO-28", "factory-control-local-commands.js",
         "test-factory-control-local-commands.cjs", ("ac20",),
         "Local commands pure contract: PASS"),
    Case("PROTO-29", "factory-control-local-commands.js",
         "test-factory-control-local-commands.cjs", ("ac21",),
         "Local commands pure contract: PASS"),
    Case("PROTO-30", "factory-control-local-commands.js",
         "test-factory-control-local-commands.cjs", ("ac22",),
         "Local commands pure contract: PASS"),
    Case("PROTO-31", "factory-control-local-commands.js",
         "test-factory-control-local-commands.cjs", ("ac23",),
         "Local commands pure contract: PASS"),
)

# B needs real installed extension, browser parity and check/release correlation.
# Synthetic Node tests cannot turn README-01-01 into browser evidence.
EXTERNAL = {"README-01-01": ("B", "Chrome/Safari install smoke plus exact-SHA CI and release receipts")}
ROW_IDS = {case.row for case in CASES} | set(EXTERNAL)


def matrix_rows(source: object) -> dict[str, tuple[str, ...]]:
    """Reject omitted, duplicate, ambiguous or silently promoted rows."""
    if not isinstance(source, str):
        raise ValueError("UNKNOWN: coverage matrix missing")
    rows: dict[str, tuple[str, ...]] = {}
    for line in source.splitlines():
        if not line.startswith("| "):
            continue
        cells = tuple(cell.strip() for cell in line.strip().strip("|").split("|"))
        key = cells[0].split(" · ", 1)[0] if cells else ""
        if key not in ROW_IDS:
            continue
        if (key in rows or len(cells) != 5 or cells[2] != "NO_VERIFICABLE"
                or "Estado operativo: UNKNOWN" not in cells[3]
                or not cells[4].startswith("[#")):
            raise ValueError("UNKNOWN: invalid matrix row: " + key)
        rows[key] = cells
    if set(rows) != ROW_IDS:
        raise ValueError("UNKNOWN: missing matrix rows: " + repr(ROW_IDS - set(rows)))
    return rows


def local_receipt(case: Case, source: object, *, executable: str | None) -> str:
    """Execute actual module tests, never certify installation or remote IO."""
    if not isinstance(source, str) or not source or executable is None:
        return UNKNOWN
    if case.row not in ROW_IDS or not (ROOT / case.source).is_file():
        return UNKNOWN
    script = ROOT / case.script
    if not script.is_file():
        return UNKNOWN
    if "./" + case.source not in script.read_text(encoding="utf-8"):
        return UNKNOWN
    try:
        result = subprocess.run(
            [executable, str(script), *case.args],
            cwd=ROOT, text=True, capture_output=True, check=False, timeout=90,
        )
    except (OSError, subprocess.TimeoutExpired):
        return UNKNOWN
    if result.returncode != 0 or case.receipt not in result.stdout:
        return UNKNOWN
    return OFFLINE


class CoberturaAutofactory05Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.matrix = MATRIX.read_text(encoding="utf-8")
        cls.rows = matrix_rows(cls.matrix)
        cls.node = shutil.which("node")

    def test_contrato_principal(self) -> None:
        """AC-01: offline rows exercise JS modules; external row remains B."""
        self.assertEqual(20, len(self.rows))
        self.assertEqual(("B", "Chrome/Safari install smoke plus exact-SHA CI and release receipts"),
                         EXTERNAL["README-01-01"])
        cache: dict[tuple[str, tuple[str, ...], str], str] = {}
        for case in CASES:
            with self.subTest(row=case.row):
                row = self.rows[case.row]
                self.assertIn(case.source, row[3], "source must match the row")
                key = (case.script, case.args, case.receipt)
                if key not in cache:
                    cache[key] = local_receipt(case, row[3], executable=self.node)
                self.assertEqual(OFFLINE, cache[key],
                                 f"{case.row}: actual Node behavior absent/invalid")
        self.assertEqual("NO_VERIFICABLE", self.rows["README-01-01"][2])

    def test_falla_cerrado(self) -> None:
        """AC-02: malformed matrix and real negative scenarios must fail."""
        for identifier in ROW_IDS:
            with self.subTest(row=identifier):
                line = next(line for line in self.matrix.splitlines()
                            if line.startswith("| " + identifier + " · "))
                invalid = (
                    self.matrix.replace(line + "\n", "", 1),
                    self.matrix + "\n" + line,
                    self.matrix.replace(line, line.replace("NO_VERIFICABLE", "CUBIERTO", 1), 1),
                )
                for text in invalid:
                    with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                        matrix_rows(text)
        chosen = next(case for case in CASES if case.row == "PROTO-13")
        for source, executable in ((None, self.node), ("", self.node), ("real", None)):
            self.assertEqual(UNKNOWN, local_receipt(chosen, source, executable=executable))
        negative = (
            ("PROTO-13", (), "factory-control response consent: ok"),
            ("PROTO-18", ("failclosed",), "factory-control runtime lifecycle: ok"),
            ("PROTO-22", ("AC-02",), "AC-02: ok"),
            ("PROTO-25", ("ac03",), "Factory local publisher ac03: PASS"),
            ("PROTO-27", ("ac19",), "Local commands pure contract: PASS"),
            ("PROTO-28", ("ac20",), "Local commands pure contract: PASS"),
            ("PROTO-29", ("ac21",), "Local commands pure contract: PASS"),
            ("PROTO-30", ("ac22",), "Local commands pure contract: PASS"),
            ("PROTO-31", ("ac23",), "Local commands pure contract: PASS"),
        )
        for identifier, args, receipt in negative:
            with self.subTest(negative=identifier):
                case = next(c for c in CASES if c.row == identifier)
                self.assertEqual(OFFLINE, local_receipt(
                    Case(case.row, case.source, case.script, args, receipt),
                    self.rows[identifier][3], executable=self.node))

    def test_sin_datos_reales(self) -> None:
        """AC-03: local synthetic test execution only; no live attestations."""
        self.assertEqual(19, len(CASES))
        self.assertEqual(ROW_IDS, set(self.rows))
        for case in CASES:
            with self.subTest(row=case.row):
                self.assertRegex(case.row, r"^PROTO-(?:1[3-9]|2\d|3[01])$")
                self.assertTrue(re.fullmatch(r"test-factory-control-[a-z0-9-]+\.cjs", case.script))
                self.assertTrue(re.fullmatch(r"factory-control-[a-z0-9-]+\.js", case.source))
                self.assertFalse(any("/" in arg or "\\" in arg for arg in case.args))
                self.assertEqual("NO_VERIFICABLE", self.rows[case.row][2])
        self.assertEqual("NO_VERIFICABLE", self.rows["README-01-01"][2])
        self.assertNotEqual("CUBIERTO", OFFLINE)
        self.assertNotEqual("VALIDADO EN PRODUCCION", OFFLINE)
        self.assertNotIn("http", " ".join([case.script for case in CASES]))


if __name__ == "__main__":
    unittest.main()
