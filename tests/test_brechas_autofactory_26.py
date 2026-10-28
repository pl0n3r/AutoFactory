#!/usr/bin/env python3
"""#333: synthetic, fail-closed README-07-03..08-02 coverage contracts.

Passing offline tests never attests a real Github lease, review, release,
Safari installation, browser permissions, consent or live operation.
"""
from __future__ import annotations

import ast
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "UNKNOWN"
OFFLINE = "OFFLINE_CONTRACT"
GAPS = {
    "README-07-03": ("Ciclo de entrega", "se usa el flujo canónico"),
    "README-07-04": ("Ciclo de entrega", "no equivale a producción VERDE"),
    "README-07-05": ("Ciclo de entrega", "evidencia de release y smoke"),
    "README-08-01": ("Calidad y seguridad", "No registrar texto de chats"),
    "README-08-02": ("Calidad y seguridad", "No automatizar aprobaciones"),
}
# All scripts use injected local fakes, not real permissions, profiles or LAN.
SCENARIOS = {
    "README-07-03": (
        ("test-factory-governance.cjs", "Factory governance:"),
    ),
    "README-07-04": (
        ("test-release-evidence.cjs", "Release evidence gate: fail-closed"),
    ),
    "README-07-05": (
        ("test-release-evidence.cjs", "Release evidence gate: fail-closed"),
        ("test-release-workflow.cjs", "Release metadata and workflow:"),
    ),
    "README-08-01": (
        ("test-background.cjs", "AF152-PRIVACY-OK"),
        ("test-factory-control-local-publisher.cjs",
         "Factory local publisher ac02: PASS"),
    ),
    "README-08-02": (
        ("test-factory-control-authorization.cjs",
         "Factory Control authorization:"),
        ("test-factory-control-activation.cjs",
         "factory-control activation preflight: ok"),
    ),
}


def matrix_rows(document: object) -> dict[str, tuple[str, ...]]:
    """All five rows must remain exact and explicitly unverified."""
    if not isinstance(document, str):
        raise ValueError("UNKNOWN: missing matrix")
    found: dict[str, tuple[str, ...]] = {}
    for line in document.splitlines():
        if not line.lstrip().startswith("| README-"):
            continue
        cells = tuple(piece.strip() for piece in line.strip().strip("|").split("|"))
        key = cells[0].split(" · ", 1)[0] if cells else ""
        if key not in GAPS:
            continue
        if (key in found or len(cells) != 5 or not all(cells)
                or cells[0] != key + " · README.md"
                or cells[2] != "NO_VERIFICABLE"
                or "Contraste #292" not in cells[3]
                or "Estado operativo: UNKNOWN" not in cells[3]):
            raise ValueError("UNKNOWN: malformed/duplicate/promoted row " + key)
        found[key] = cells
    if set(found) != set(GAPS):
        raise ValueError("UNKNOWN: missing gap rows")
    return found


def section(document: object, title: str) -> str | None:
    """Missing or repeated heading is not proof of an obligation."""
    heading = "## " + title + "\n"
    if not isinstance(document, str) or document.count(heading) != 1:
        return None
    return document.split(heading, 1)[1].split("\n## ", 1)[0]


def synthetic_lease() -> dict:
    """Not a GitHub lease; all identifiers and timestamps are synthetic."""
    return {
        "version": 3, "active": True, "owner": "synthetic-agent",
        "reservation_id": "11111111-2222-4333-8444-555555555555",
        "branch": "trabajo/issue-333", "head_sha": "a" * 40,
        "validated_sha": "a" * 40, "reviewed_sha": "a" * 40,
        "claims_ok": True,
    }


def canonical_flow(document: object, receipt: object) -> str:
    """Model V3 and exact HEAD, never treat it as genuine live provenance."""
    text = section(document, "Ciclo de entrega")
    stages = ("Issue", "estado/reserva", "trabajo/issue-N", "PR",
              "tests/Factory gates", "revisión", "merge serial",
              "release oficial", "smoke de instalación/carga Chrome/Safari")
    if text is None or "se usa el flujo canónico" not in text:
        return UNKNOWN
    positions = [text.find(item) for item in stages]
    if (any(pos < 0 for pos in positions) or positions != sorted(positions)
            or len(set(positions)) != len(positions)):
        return UNKNOWN
    if (type(receipt) is not dict or set(receipt) != {
            "version", "active", "owner", "reservation_id", "branch",
            "head_sha", "validated_sha", "reviewed_sha", "claims_ok"}):
        return UNKNOWN
    if (type(receipt["version"]) is not int or receipt["version"] != 3
            or receipt["active"] is not True or receipt["claims_ok"] is not True
            or type(receipt["owner"]) is not str or not receipt["owner"]
            or type(receipt["reservation_id"]) is not str
            or not re.fullmatch(r"[a-f0-9-]{36}", receipt["reservation_id"])
            or receipt["branch"] != "trabajo/issue-333"
            or type(receipt["head_sha"]) is not str
            or not re.fullmatch(r"[a-f0-9]{40}", receipt["head_sha"])
            or receipt["validated_sha"] != receipt["head_sha"]
            or receipt["reviewed_sha"] != receipt["head_sha"]):
        return UNKNOWN
    return OFFLINE


def delivery_contract(document: object, signs: object) -> str:
    """Green code and merge cannot be called production without release smoke."""
    text = section(document, "Ciclo de entrega")
    required = {"merge", "ci", "release", "chrome_smoke", "safari_smoke"}
    if (text is None or "no equivale a producción VERDE" not in text
            or "evidencia de release y smoke" not in text
            or type(signs) is not dict or set(signs) != required
            or any(type(value) is not bool for value in signs.values())
            or not all(signs.values())):
        return UNKNOWN
    return OFFLINE


def privacy_contract(document: object, rules: object) -> str:
    text = section(document, "Calidad y seguridad")
    if (text is None or not all(s in text for s in (
            "No registrar texto de chats", "tokens", "correos",
            "IDs identificables de conversación", "No automatizar aprobaciones",
            "permisos", "compras", "CAPTCHA", "MFA", "acciones destructivas"))
            or not isinstance(rules, str)
            or not all(s in rules for s in (
                "no registrar texto de conversaciones", "tokens",
                "IDs de conversación",
                "Prohibido usar automatización para eludir"))):
        return UNKNOWN
    return OFFLINE


def exercise_node(script: str, marker: str) -> bool:
    """Execute actual allowlisted regressions; never print sensitive logs."""
    allowed = {script for cases in SCENARIOS.values() for script, _ in cases}
    node = shutil.which("node")
    if node is None or script not in allowed or not (ROOT / script).is_file():
        return False
    command = [node, script]
    if script == "test-factory-control-local-publisher.cjs":
        command.append("ac02")
    try:
        result = subprocess.run(
            command, cwd=ROOT, capture_output=True, text=True,
            timeout=35, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and marker in result.stdout


def operational_evidence(_row: object = None, _receipt: object = None) -> str:
    """Synthetic evidence never certifies an installed product or go-live."""
    return UNKNOWN


class BrechasAutofactory26Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.matrix = (ROOT / "docs/matriz-cobertura.md").read_text(encoding="utf-8")
        cls.rows = matrix_rows(cls.matrix)
        cls.readme = (ROOT / "README.md").read_text(encoding="utf-8")
        cls.rules = (ROOT / "AGENTES.md").read_text(encoding="utf-8")

    def test_contrato_principal(self) -> None:
        """AC-01: five concrete gaps and seven executable Node regressions."""
        self.assertEqual(set(self.rows), set(GAPS))
        for key, (heading, token) in GAPS.items():
            with self.subTest(unit=key):
                content = section(self.readme, heading)
                self.assertIsNotNone(content)
                self.assertIn(token, content)
                self.assertEqual(self.rows[key][2], "NO_VERIFICABLE")
                self.assertIn("UNKNOWN", self.rows[key][3])
                for script, expected in SCENARIOS[key]:
                    self.assertTrue(exercise_node(script, expected),
                                    key + ": UNKNOWN offline execution missing")
                self.assertEqual(operational_evidence(self.rows[key]), UNKNOWN)
        self.assertEqual(canonical_flow(self.readme, synthetic_lease()), OFFLINE)
        positive = dict.fromkeys(
            ("merge", "ci", "release", "chrome_smoke", "safari_smoke"), True)
        self.assertEqual(delivery_contract(self.readme, positive), OFFLINE)
        self.assertEqual(privacy_contract(self.readme, self.rules), OFFLINE)

    def test_falla_cerrado(self) -> None:
        """AC-02: missing, duplicate, malformed, stale or fabricated -> UNKNOWN."""
        for key in GAPS:
            row = next(s for s in self.matrix.splitlines()
                       if s.startswith("| " + key + " ·"))
            damaged = (
                self.matrix.replace(row, ""),
                self.matrix + "\n" + row,
                self.matrix.replace(row, "| " + key + " | incomplete |"),
                self.matrix.replace(row, row.replace("NO_VERIFICABLE", "CUBIERTO", 1)),
                self.matrix.replace(row, row.replace(
                    "Estado operativo: UNKNOWN", "Estado operativo: VERDE", 1)),
            )
            for candidate in damaged:
                with self.subTest(unit=key):
                    with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                        matrix_rows(candidate)
        for field, value in (
            ("active", False), ("claims_ok", False), ("version", 2),
            ("head_sha", "short"), ("validated_sha", "b" * 40),
            ("reviewed_sha", "b" * 40), ("reservation_id", ""),
            ("branch", "main"), ("owner", ""),
        ):
            altered = synthetic_lease()
            altered[field] = value
            self.assertEqual(canonical_flow(self.readme, altered), UNKNOWN, field)
        self.assertEqual(canonical_flow(self.readme, {}), UNKNOWN)
        self.assertEqual(canonical_flow(self.readme, None), UNKNOWN)
        missing = self.readme.replace("se usa el flujo canónico", "no disponible")
        self.assertEqual(canonical_flow(missing, synthetic_lease()), UNKNOWN)
        complete = dict.fromkeys(
            ("merge", "ci", "release", "chrome_smoke", "safari_smoke"), True)
        for key in complete:
            altered = dict(complete)
            altered[key] = False
            self.assertEqual(delivery_contract(self.readme, altered), UNKNOWN)
        self.assertEqual(delivery_contract(self.readme, {"ci": True}), UNKNOWN)
        self.assertEqual(privacy_contract(self.readme, ""), UNKNOWN)
        self.assertFalse(exercise_node("../test-core.cjs", "ok"))
        self.assertFalse(exercise_node("nonexistent.cjs", "ok"))

    def test_sin_datos_reales(self) -> None:
        """AC-03: only local files, dummy receipts and fake transports."""
        source = Path(__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        modules = {item.name.partition(".")[0]
                   for statement in ast.walk(tree)
                   if isinstance(statement, ast.Import)
                   for item in statement.names}
        modules |= {statement.module.partition(".")[0]
                    for statement in ast.walk(tree)
                    if isinstance(statement, ast.ImportFrom) and statement.module}
        self.assertFalse(modules & {"socket", "urllib", "requests", "httpx"})
        self.assertNotRegex(source, r"-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----")
        self.assertNotRegex(source, r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
        for cases in SCENARIOS.values():
            for script, marker in cases:
                self.assertRegex(script, r"^test-[\w-]+\.cjs$")
                self.assertTrue(marker)
        self.assertEqual(operational_evidence(synthetic_lease()), UNKNOWN)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: local passes cannot assert runtime, prod, or real approval."""
        for key in GAPS:
            with self.subTest(unit=key):
                self.assertEqual(self.rows[key][2], "NO_VERIFICABLE")
                self.assertIn("Estado operativo: UNKNOWN", self.rows[key][3])
                for claim in (
                    None, {}, True, {"ci": "success"},
                    {"merged": True}, {"chrome": True, "safari": True},
                    {"pairing": True, "consent": True}, synthetic_lease(),
                ):
                    self.assertEqual(operational_evidence(key, claim), UNKNOWN)
        security = section(self.readme, "Calidad y seguridad")
        self.assertIsNotNone(security)
        self.assertIn("No registrar texto de chats", security)
        self.assertIn("No automatizar aprobaciones", security)


if __name__ == "__main__":
    unittest.main()
