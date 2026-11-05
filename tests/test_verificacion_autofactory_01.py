#!/usr/bin/env python3
"""#450: 40 exact README coverage rows, evidence limits and mutation regressions.

This test may prove source text and offline contracts; never actual installation,
GitHub temporal state, Safari native smoke, ControlBot pairing or go-live.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
README = ROOT / "README.md"
REPORT = ROOT / "docs/verificacion/verificacion-01.md"
MATRIX = ROOT / "docs/matriz-cobertura.md"
SPEC = r"""README-01-01|Operational Cockpit|Validate sobre main|B_EXTERNA|.github/workflows/validate.yml|name: Validate / Pruebas y smoke Chrome|#220
README-01-02|Operational Cockpit|v1.7.38|B_EXTERNA|CHANGELOG.md|## 1.7.38|#219
README-01-03|Operational Cockpit|ControlBot, consola privada|C_DECLARATIVA|AGENTES.md|ControlBot|#1
README-01-04|Operational Cockpit|Este enlace no activa pairing ni tráfico real|C_DECLARATIVA|factory-control-activation.js|legal_blocked|#134
README-01-05|Operational Cockpit|smoke real pendiente|B_EXTERNA|AGENTES.md|smoke de instalación/carga|#122
README-02-01|Estado de la versión publicada|recuperación conservadora de pestañas dirigidas|B_EXTERNA|CHANGELOG.md|## 1.7.38|#122
README-02-02|Estado de la versión publicada|CHANGELOG.md|C_DECLARATIVA|CHANGELOG.md|## 1.7.38|#219
README-02-03|Estado de la versión publicada|no autorizan por sí mismas el puente con ControlBot|C_DECLARATIVA|decisiones.yml|D-061|#134
README-03-01|Work Queue|Issues críticos abiertos|B_EXTERNA|.github/workflows/coordinacion.yml|issues:|#219
README-03-02|Work Queue|El estado actual lo determina GitHub|B_EXTERNA|.github/workflows/coordinacion.yml|pull_request:|#219
README-03-03|Work Queue|#228 — paridad Chrome/Safari|B_EXTERNA|AGENTES.md|trabajo/issue-N|#228
README-03-04|Work Queue|#134 — readiness del bridge|B_EXTERNA|AGENTES.md|D-061|#134
README-03-05|Work Queue|#219 — SonarCloud|B_EXTERNA|.github/workflows/validate.yml|name: Validate / Pruebas y smoke Chrome|#219
README-04-01|Qué hace el producto|Observa únicamente las pestañas habilitadas|A_PARCIAL|autopilot-core.js|COMPOSER_SELECTORS|#122
README-04-02|Qué hace el producto|Gestiona estados transitorios|A_PARCIAL|content.js|adaptiveRecovery|#122
README-04-03|Qué hace el producto|Conserva contratos offline|A_PARCIAL|factory-control-activation.js|legal_blocked|#134
README-05-01|Arquitectura en 60 segundos|aporta gobernanza|C_DECLARATIVA|AGENTES.md|Factory v1|#1
README-05-02|Arquitectura en 60 segundos|Manifest V3|A_PARCIAL|manifest.json|"manifest_version": 3|#122
README-05-03|Arquitectura en 60 segundos|sigue declarativo|C_DECLARATIVA|decisiones.yml|D-061|#134
README-06-01|Stack e infraestructura|JavaScript para|A_PARCIAL|manifest.json|"background": {|#122
README-06-02|Stack e infraestructura|Node.js ≥20|A_PARCIAL|package.json|"pretest":|#220
README-06-03|Stack e infraestructura|No existe backend Hostinger|C_DECLARATIVA|AGENTES.md|no servidor web|#1
README-06-04|Stack e infraestructura|Permiso LAN opcional|A_PARCIAL|manifest.json|"optional_host_permissions"|#134
README-06-05|Stack e infraestructura|paridad de manifiestos y rollback|A_PARCIAL|scripts/verify-release-evidence.cjs|safari_smoke|#122
README-07-01|Ciclo de entrega|Issue → estado/reserva|B_EXTERNA|AGENTES.md|trabajo/issue-N|#219
README-07-02|Ciclo de entrega|Cuando el bot de coordinación no esté instalado|C_DECLARATIVA|AGENTES.md|fallback local|#219
README-07-03|Ciclo de entrega|Una vez instalada coordinación Factory|C_DECLARATIVA|.github/workflows/coordinacion.yml|pl0n3r/factory/.github/workflows/coordinacion.yml@v1|#219
README-07-04|Ciclo de entrega|Un merge o CI verde|A_PARCIAL|scripts/verify-release-evidence.cjs|chrome_smoke|#122
README-07-05|Ciclo de entrega|La entrega instalable exige|A_PARCIAL|scripts/verify-release-evidence.cjs|rollback|#122
README-08-01|Calidad y seguridad|No registrar texto de chats|A_PARCIAL|AGENTES.md|tokens|#219
README-08-02|Calidad y seguridad|No automatizar aprobaciones|A_PARCIAL|factory-control-authorization.js|Command not authorized|#134
README-08-03|Calidad y seguridad|No eludir rate limits|A_PARCIAL|account-budget.js|budgetCapacityAt|#219
README-08-04|Calidad y seguridad|Toda modificación de tratamientos personales|C_DECLARATIVA|AGENTES.md|datos.yml|#1
README-08-05|Calidad y seguridad|Mantener release anterior|B_EXTERNA|scripts/verify-release-evidence.cjs|rollback|#122
README-08-06|Calidad y seguridad|Preservar paridad Chrome/Safari|A_PARCIAL|scripts/verify-extension-assets.cjs|validateExtensionTree|#122
README-08-07|Calidad y seguridad|permanece sin tráfico real|A_PARCIAL|factory-control-local-publisher.js|optedIn|#134
README-09-01|Roadmap y fuentes de verdad|Puente y alcance|C_DECLARATIVA|README.md|#134|#1
README-09-02|Roadmap y fuentes de verdad|Ejecución y revisiones|C_DECLARATIVA|AGENTES.md|PR existente|#219
README-09-03|Roadmap y fuentes de verdad|Decisiones y límites|C_DECLARATIVA|decisiones.yml|D-062|#1
README-09-04|Roadmap y fuentes de verdad|Versiones reales|B_EXTERNA|CHANGELOG.md|## 1.7.38|#219"""
CASES = [tuple(line.split("|")) for line in SPEC.splitlines()]
LEVELS = {"A_PARCIAL", "B_EXTERNA", "C_DECLARATIVA"}
ROW = re.compile(
    r"^\\| (README-\\d{2}-\\d{2}) \\| (A_PARCIAL|B_EXTERNA|C_DECLARATIVA) "
    r"\\| \\x60([^\\x60]+)\\x60 \\| \\x60([^\\x60]+)\\x60 "
    r"\\| (#[0-9]+) \\|$", re.M
)


def expected_ids():
    return {f"README-{group:02d}-{i:02d}"
            for group, size in enumerate((5, 3, 5, 3, 3, 5, 5, 7, 4), 1)
            for i in range(1, size + 1)}


def extract_section(readme, heading):
    match = re.search(r"(?ms)^## " + re.escape(heading)
                      + r"[ \\t]*\\n(.*?)(?=^## |\\Z)", readme)
    if match is None:
        raise AssertionError(f"Missing README section {heading}")
    return match.group(1)


def verify_readme(readme):
    for ident, section, anchor, *_ in CASES:
        if anchor not in extract_section(readme, section):
            raise AssertionError(f"{ident}: exact assertion changed: {anchor}")


def report_rows(report):
    rows = ROW.findall(report)
    if len(rows) != 40 or len({row[0] for row in rows}) != 40:
        raise ValueError("Expected 40 unique and complete ledger rows")
    if {row[0] for row in rows} != expected_ids():
        raise ValueError("Unknown, absent or duplicated row ID")
    for line in report.splitlines():
        if line.startswith("| README-") and not ROW.fullmatch(line):
            raise ValueError("Invalid ledger or unsupported promotion")
    for (ident, _, _, level, source, token, issue), observed in zip(CASES, rows):
        if observed != (ident, level, source, token, issue):
            raise ValueError(f"{ident}: ledger differs from source contract")
    if "estado operativo \\x60UNKNOWN\\x60" not in report:
        raise ValueError("Missing UNKNOWN operational caveat")
    if "no certificado de instalación" not in report:
        raise ValueError("Missing non-operational limit")
    return rows


def verify_sources(changes=None):
    changes = changes or {}
    for ident, _, _, level, source, token, issue in CASES:
        if level not in LEVELS or not re.fullmatch(r"#[1-9][0-9]*", issue):
            raise AssertionError(f"{ident}: invalid classification or issue")
        path = ROOT / source
        if not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise AssertionError(f"{ident}: missing or escaped repository source")
        content = changes.get(source)
        if content is None:
            content = path.read_text(encoding="utf-8")
        if token not in content:
            raise AssertionError(f"{ident}: source assertion not supported")
    if "README-09-05" in {row[0] for row in CASES}:
        raise AssertionError("Out-of-scope row leaked")


class VerificacionAutofactory01Tests(unittest.TestCase):
    def test_criterio_principal(self):
        self.assertEqual(40, len(CASES))
        self.assertEqual(expected_ids(), {x[0] for x in CASES})
        self.assertTrue(MATRIX.is_file())
        verify_readme(README.read_text(encoding="utf-8"))
        self.assertEqual(40, len(report_rows(REPORT.read_text(encoding="utf-8"))))
        verify_sources()
        self.assertNotIn("CUBIERTO |", REPORT.read_text(encoding="utf-8"))
        self.assertNotIn("VALIDATED_IN_PRODUCTION", REPORT.read_text(encoding="utf-8"))
        self.assertTrue(shutil.which("node"), "Node is required for real offline probes")
        for cmd in (
            ["node", "test-core.cjs"],
            ["node", "test-extension-integrity.cjs"],
            [sys.executable, "-m", "unittest",
             "tests.test_cobertura_autofactory_07.CoberturaAutofactory07Tests.test_contrato_principal"],
        ):
            with self.subTest(command=cmd[-1]):
                done = subprocess.run(cmd, cwd=ROOT, capture_output=True,
                                      text=True, check=False, timeout=50)
                self.assertEqual(0, done.returncode,
                                 f"Offline regression {cmd[-1]} failed (exit {done.returncode})")

    def test_mutaciones_fallan_cerrado(self):
        original = README.read_text(encoding="utf-8")
        report = REPORT.read_text(encoding="utf-8")
        with self.assertRaises(AssertionError):
            verify_readme(original.replace("Validate sobre main", "Validate desconocido", 1))
        with self.assertRaises(ValueError):
            report_rows(report.replace("| README-01-01 |", "| README-01-02 |", 1))
        with self.assertRaises(ValueError):
            report_rows(report.replace("| B_EXTERNA |", "| CUBIERTO |", 1))
        with self.assertRaises(ValueError):
            report_rows(report.replace("no certificado de instalación", "certificado", 1))
        with self.assertRaises(AssertionError):
            src = (ROOT / "manifest.json").read_text(encoding="utf-8")
            verify_sources({"manifest.json": src.replace('"manifest_version": 3', '"manifest_version": 2', 1)})
        with self.assertRaises(AssertionError):
            src = (ROOT / "scripts/verify-release-evidence.cjs").read_text(encoding="utf-8")
            verify_sources({"scripts/verify-release-evidence.cjs": src.replace("safari_smoke", "no_smoke", 1)})


if __name__ == "__main__":
    unittest.main()
