#!/usr/bin/env python3
"""#319: five independent synthetic coverage contracts, without live authority.

Offline unit tests cannot attest an installed Safari extension, real chat
continuity, an authenticated Sonar diagnosis or ControlBot pairing.
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
LOCAL = "OFFLINE_TEST_EXECUTED"


@dataclass(frozen=True)
class Case:
    identifier: str
    source: str
    test_file: str
    methods: tuple[str, ...]


CASES = (
    Case("DOC-SESSION-KEEPALIVE-04", "factory-control-session-keepalive.js",
         "tests/test_factory_control_session_keepalive.py", (
             "SessionKeepAliveTests.test_ac01_pacing_and_bounded_reengagement",
             "SessionKeepAliveTests.test_ac02_account_budget_and_stop_reasons",
         )),
    Case("DOC-SONAR-CHECK-DETAILS-01", ".github/workflows/sonar-check-details.yml",
         "tests/test_sonar_relay_sanitization.py", (
             "SonarRelaySanitizationTests.test_adversarial_escaping",
             "SonarRelaySanitizationTests.test_exact_head_contract",
         )),
    Case("ISSUE-1", "docs/factory-control-protocol.md",
         "tests/test_factory_control_runtime.py", (
             "FactoryControlRuntimeTests.test_runtime_composes_heartbeat_and_command_pump_only_while_active",
             "FactoryControlRuntimeTests.test_stop_profile_drift_or_stale_async_result_fails_closed",
         )),
    Case("ISSUE-122", "safari/ChatGPT Autopilot Local Extension/Info.plist",
         "tests/test_safari_build_smoke.py", (
             "SafariBuildSmokeTests.test_unsigned_build_uses_attested_sources_and_expected_bundle_version",
             "SafariBuildSmokeTests.test_source_drift_or_build_failure_never_emits_green_evidence",
         )),
    Case("ISSUE-129", "factory-control-pairing.js",
         "tests/test_factory_control_pairing_public_result.py", (
             "PairingPublicResultTests.test_success_response_excludes_opaque_credential",
             "PairingPublicResultTests.test_failure_and_compensation_results_are_sanitized",
         )),
)


def parse_rows(content: str) -> dict[str, tuple[str, ...]]:
    """Missing, duplicate, malformed or prematurely promoted rows fail closed."""
    found: dict[str, tuple[str, ...]] = {}
    wanted = {case.identifier for case in CASES}
    for line in content.splitlines():
        if not line.startswith("| "):
            continue
        fields = tuple(field.strip() for field in line.strip().strip("|").split("|"))
        key = fields[0].split(" · ", 1)[0] if fields else ""
        if key not in wanted:
            continue
        if key in found or len(fields) != 5 or not all(fields):
            raise ValueError("UNKNOWN: duplicate or malformed " + key)
        if fields[2] != "NO_VERIFICABLE" or "UNKNOWN" not in fields[3]:
            raise ValueError("UNKNOWN: unjustified coverage " + key)
        found[key] = fields
    if set(found) != wanted:
        raise ValueError("UNKNOWN: missing gap rows " + ", ".join(sorted(wanted - found.keys())))
    return found


def inspect(case: Case, row: tuple[str, ...] | None,
            source_exists: bool, tests_executed: bool) -> str:
    """Only local exercised contracts can be credited, never production."""
    if (row is None or len(row) != 5 or row[2] != "NO_VERIFICABLE"
            or "UNKNOWN" not in row[3]
            or chr(96) + case.source + chr(96) not in row[3]
            or chr(96) + case.test_file + chr(96) not in row[3]
            or not source_exists or not tests_executed):
        return UNKNOWN
    return LOCAL


def operational_evidence(_candidate: object = None) -> str:
    """No authenticated external receipt is available to offline tests."""
    return UNKNOWN


def exercise_existing(case: Case) -> unittest.result.TestResult:
    """Run real selected tests instead of merely finding their names."""
    module = case.test_file[:-3].replace("/", ".")
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for method in case.methods:
        target = loader.loadTestsFromName(module + "." + method)
        if target.countTestCases() != 1:
            raise AssertionError(case.identifier + ": UNKNOWN test target " + method)
        suite.addTests(target)
    return unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)


class BrechasAutofactory12Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.matrix = MATRIX.read_text(encoding="utf-8")
        cls.rows = parse_rows(cls.matrix)

    def test_contrato_principal(self) -> None:
        # AC-01: 5 rows, 10 existing asserting behavioral regressions executed.
        self.assertEqual(5, len(CASES))
        self.assertEqual(set(self.rows), {case.identifier for case in CASES})
        for case in CASES:
            with self.subTest(row=case.identifier):
                self.assertTrue((ROOT / case.source).is_file())
                self.assertTrue((ROOT / case.test_file).is_file())
                self.assertEqual(2, len(case.methods))
                result = exercise_existing(case)
                self.assertEqual(result.testsRun, 2, case.identifier)
                self.assertTrue(result.wasSuccessful(),
                                case.identifier + ": UNKNOWN offline regression failed")
                self.assertEqual(inspect(case, self.rows[case.identifier], True, True), LOCAL)
                self.assertEqual(operational_evidence(result), UNKNOWN)

    def test_falla_cerrado(self) -> None:
        # AC-02: do not accept missing, ambiguous or fabricated proof.
        case = CASES[0]
        row = self.rows[case.identifier]
        for present, executed in ((False, True), (True, False), (False, False)):
            self.assertEqual(inspect(case, row, present, executed), UNKNOWN)
        damaged = list(row)
        damaged[2] = "CUBIERTO"
        self.assertEqual(inspect(case, tuple(damaged), True, True), UNKNOWN)
        damaged = list(row)
        damaged[3] = "UNKNOWN: no test path"
        self.assertEqual(inspect(case, tuple(damaged), True, True), UNKNOWN)
        self.assertEqual(inspect(case, None, True, True), UNKNOWN)
        line = next(item for item in self.matrix.splitlines()
                    if item.startswith("| " + case.identifier + " ·"))
        for invalid in (
            self.matrix.replace(line, ""),
            self.matrix + "\n" + line,
            self.matrix.replace(line, "| " + case.identifier + " | malformed |"),
            self.matrix.replace(line, line.replace("NO_VERIFICABLE", "CUBIERTO", 1)),
        ):
            with self.subTest(reason="invalid evidence"):
                with self.assertRaises(ValueError):
                    parse_rows(invalid)
        self.assertEqual(operational_evidence({"production": "success"}), UNKNOWN)

    def test_sin_datos_reales(self) -> None:
        # AC-03: source-controlled files and pure synthetic test fixtures.
        source = Path(__file__).read_text(encoding="utf-8")
        self.assertNotRegex(source, r"(?m)^(?:from|import)\s+(?:requests|httpx|urllib|socket)\b")
        self.assertNotRegex(source, r"-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----")
        self.assertNotRegex(source, r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
        forbidden = ("fet" + "ch(", "http." + "request(",
                     "https." + "request(", "send" + "Message(",
                     "local" + "Storage.")
        self.assertFalse(any(value in source for value in forbidden))
        for case in CASES:
            self.assertFalse(Path(case.source).is_absolute())
            self.assertTrue(case.test_file.startswith("tests/test_"))
            self.assertTrue(all(re.fullmatch(r"[A-Za-z]\w*\.test_\w+", name)
                                for name in case.methods))

    def test_estados_unknown_explicitos(self) -> None:
        # AC-04: no source matrix modification, no CI or browser attestation.
        for case in CASES:
            with self.subTest(row=case.identifier):
                row = self.rows[case.identifier]
                self.assertEqual(row[2], "NO_VERIFICABLE")
                self.assertIn("UNKNOWN", row[3])
                self.assertEqual(inspect(case, row, True, False), UNKNOWN)
                self.assertEqual(operational_evidence({"CI": "success"}), UNKNOWN)
                self.assertEqual(operational_evidence({"live": "GREEN"}), UNKNOWN)
        self.assertEqual(operational_evidence(), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
