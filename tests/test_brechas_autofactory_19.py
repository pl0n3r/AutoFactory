#!/usr/bin/env python3
"""AutoFactory #326: offline, executable contracts for PROTO-23..PROTO-27.

Passing synthetic Chrome/Node tests does not attest an installed extension,
ControlBot pairing, authorized LAN traffic or production readiness.
"""
from __future__ import annotations

from dataclasses import dataclass
import io
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
UNKNOWN = "UNKNOWN"
OFFLINE = "OFFLINE_TEST_EXECUTED"


@dataclass(frozen=True)
class Case:
    identifier: str
    source: str
    test_file: str
    methods: tuple[str, ...]


CASES = (
    Case("PROTO-23", "factory-control-heartbeat.js",
         "tests/test_factory_control_heartbeat_presence.py", (
             "HeartbeatPresenceTests.test_interval_and_confirmed_delivery",
             "HeartbeatPresenceTests.test_stopped_invalid_clock_and_private_payload",
         )),
    Case("PROTO-24", "factory-control-account-state.js",
         "tests/test_factory_control_account_state.py", (
             "FactoryControlAccountStateTests.test_signed_out_signal_excludes_sensitive_content",
             "FactoryControlAccountStateTests.test_recovery_to_ready_and_stale_fail_closed",
         )),
    Case("PROTO-25", "factory-control-local-publisher.js",
         "tests/test_factory_control_local_publisher.py", (
             "FactoryControlLocalPublisherTests.test_ac02_never_transmit_chat_content_or_account_ids",
             "FactoryControlLocalPublisherTests.test_ac03_disabled_switch_never_sends",
         )),
    Case("PROTO-26", "factory-control-local-commands.js",
         "tests/test_factory_control_local_commands.py", (
             "FactoryControlLocalCommandsTests.test_ac01_private_hosts_only",
             "FactoryControlLocalCommandsTests.test_ac06_fail_closed_backoff_and_autopilot_isolation",
         )),
    Case("PROTO-27", "factory-control-local-commands.js",
         "tests/test_factory_control_local_commands.py", (
             "FactoryControlLocalCommandsTests.test_ac03_agent_key_never_leaks_to_payload_or_log",
             "FactoryControlLocalCommandsTests.test_ac19_remote_http_key_transport_denied",
             "FactoryControlLocalCommandsTests.test_ac22_host_grant_revocation_blocks_ack",
         )),
)


def parse_rows(content: str) -> dict[str, tuple[str, ...]]:
    """Require every canonical coverage row once, with five complete columns."""
    wanted = {case.identifier for case in CASES}
    found: dict[str, tuple[str, ...]] = {}
    for line in content.splitlines():
        if not line.startswith("| "):
            continue
        cells = tuple(part.strip() for part in line.strip().strip("|").split("|"))
        identifier = cells[0].split(" · ", 1)[0] if cells else ""
        if identifier not in wanted:
            continue
        if (identifier in found or len(cells) != 5 or not all(cells)
                or cells[0] != identifier + " · docs/factory-control-protocol.md"
                or cells[2] != "NO_VERIFICABLE"
                or "Estado operativo: UNKNOWN" not in cells[3]):
            raise ValueError("UNKNOWN: ambiguous, malformed or promoted " + identifier)
        found[identifier] = cells
    if set(found) != wanted:
        raise ValueError("UNKNOWN: missing coverage " + ", ".join(sorted(wanted - found.keys())))
    return found


def inspect(case: Case, row: tuple[str, ...] | None,
            source_exists: bool, result: unittest.result.TestResult | None) -> str:
    """Only a successful, exact-count local execution can earn offline credit."""
    if (row is None or len(row) != 5
            or row[0] != case.identifier + " · docs/factory-control-protocol.md"
            or row[2] != "NO_VERIFICABLE"
            or "Estado operativo: UNKNOWN" not in row[3]
            or "Contraste #290:" not in row[3]
            or chr(96) + case.source + chr(96) not in row[3]
            or chr(96) + case.test_file + chr(96) not in row[3]
            or not source_exists
            or not isinstance(result, unittest.result.TestResult)
            or result.testsRun != len(case.methods)
            or not result.wasSuccessful()):
        return UNKNOWN
    return OFFLINE


def operational_evidence(_anything: object = None) -> str:
    """Synthetic tests never attest deployment, network, or production."""
    return UNKNOWN


def exercise_existing(case: Case) -> unittest.result.TestResult:
    """Execute named real regression tests, including their injected Node fakes."""
    module = case.test_file[:-3].replace("/", ".")
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for method in case.methods:
        selection = loader.loadTestsFromName(module + "." + method)
        if selection.countTestCases() != 1:
            raise AssertionError(case.identifier + ": UNKNOWN regression target " + method)
        suite.addTests(selection)
    return unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)


class BrechasAutofactory19Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = MATRIX.read_text(encoding="utf-8")
        cls.rows = parse_rows(cls.text)

    def test_contrato_principal(self) -> None:
        """AC-01: five independent rows, eleven actual behavioral regressions."""
        self.assertEqual(len(CASES), 5)
        self.assertEqual(set(self.rows), {case.identifier for case in CASES})
        for case in CASES:
            with self.subTest(row=case.identifier):
                source = ROOT / case.source
                self.assertTrue(source.is_file())
                self.assertTrue((ROOT / case.test_file).is_file())
                self.assertGreaterEqual(len(case.methods), 2)
                result = exercise_existing(case)
                self.assertEqual(result.testsRun, len(case.methods))
                self.assertTrue(result.wasSuccessful(),
                                case.identifier + ": UNKNOWN local behavioral regression")
                self.assertEqual(inspect(case, self.rows[case.identifier],
                                         source.is_file(), result), OFFLINE)
                self.assertEqual(operational_evidence(result), UNKNOWN)

    def test_falla_cerrado(self) -> None:
        """AC-02: reject missing, duplicate, promoted or unexecuted evidence."""
        case = CASES[0]
        row = self.rows[case.identifier]
        for malformed in (
            self.text.replace("| " + case.identifier + " ·", "| PROTO-XX ·", 1),
            self.text + "\n" + next(s for s in self.text.splitlines()
                                    if s.startswith("| " + case.identifier + " ·")),
        ):
            with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                parse_rows(malformed)
        original = next(s for s in self.text.splitlines()
                        if s.startswith("| " + case.identifier + " ·"))
        for replacement in (
            "| " + case.identifier + " | truncated |",
            original.replace("NO_VERIFICABLE", "CUBIERTO", 1),
            original.replace("Estado operativo: UNKNOWN", "Estado operativo: GREEN", 1),
        ):
            with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                parse_rows(self.text.replace(original, replacement))
        self.assertEqual(inspect(case, row, False, None), UNKNOWN)
        self.assertEqual(inspect(case, row, True, None), UNKNOWN)
        empty = unittest.TestResult()
        self.assertEqual(inspect(case, row, True, empty), UNKNOWN)
        attempted = unittest.TestResult()
        attempted.testsRun = len(case.methods)
        attempted.failures.append((object(), "synthetic failure"))
        self.assertEqual(inspect(case, row, True, attempted), UNKNOWN)
        for bad in (None, row[:3], tuple((*row[:2], "CUBIERTO", *row[3:])),
                    tuple((*row[:3], "Estado operativo: GREEN", row[4]))):
            self.assertEqual(inspect(case, bad, True, attempted), UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        """AC-03: tests operate on checked-in code and deterministic Node fakes."""
        own = Path(__file__).read_text(encoding="utf-8")
        self.assertNotRegex(own, r"(?m)^(?:import|from)\s+(?:requests|httpx|urllib|socket)\b")
        self.assertNotRegex(own, r"-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----")
        self.assertNotRegex(own, r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
        for case in CASES:
            self.assertFalse(Path(case.source).is_absolute())
            self.assertTrue(case.test_file.startswith("tests/test_factory_control_"))
            self.assertFalse(Path(case.test_file).is_absolute())
            self.assertTrue(all(re.fullmatch(r"[A-Za-z]\w*\.test_\w+", method)
                                for method in case.methods))
            self.assertTrue((ROOT / case.source).is_file())
            self.assertTrue((ROOT / case.test_file).is_file())

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: exact-HEAD CI is external; installed extension/LAN stay UNKNOWN."""
        for case in CASES:
            with self.subTest(row=case.identifier):
                row = self.rows[case.identifier]
                self.assertEqual(row[2], "NO_VERIFICABLE")
                self.assertIn("Estado operativo: UNKNOWN", row[3])
                self.assertEqual(inspect(case, row, True, None), UNKNOWN)
                self.assertEqual(operational_evidence({"ci": "success"}), UNKNOWN)
                self.assertEqual(operational_evidence({"LAN": "connected"}), UNKNOWN)
        self.assertEqual(operational_evidence(), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
