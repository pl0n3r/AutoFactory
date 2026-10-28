#!/usr/bin/env python3
"""#341: cinco brechas README con pruebas offline, sin afirmar browser live.

LOCAL_PARTIAL verifica contratos del checkout y harnesses Node sintéticos.
UNKNOWN conserva la falta de evidencia de popup conectado, runtime y privacidad
en instalación real; no se editan la matriz ni los módulos de producción.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
CONTRAST = ROOT / "docs/contraste-af_readme.md"
README = ROOT / "README.md"
POPUP = ROOT / "popup.js"
BACKGROUND = ROOT / "background.js"
TAB_MODULE = ROOT / "local-tab-progress.js"
TAB_RUNNER = "test-local-tab-progress.cjs"
LOG_RUNNER = "test-background.cjs"
UNKNOWN = "UNKNOWN"
LOCAL_PARTIAL = "LOCAL_PARTIAL"
GAPS = {
    "README-14-02": "Estado local por pestaña — La hoja #246 y su PR #247",
    "README-14-03": "Estado local por pestaña — En el main actual, el popup",
    "README-14-04": "Estado local por pestaña — No dar por disponible ni certificado",
    "README-15-01": "Log de diagnóstico — El service worker conserva",
    "README-15-02": "Log de diagnóstico — No guarda mensajes ni contenido del chat",
}


def coverage_rows(document: object, kind: str) -> dict[str, tuple[str, ...]]:
    """Requiere cinco filas completas, únicas y aún NO_VERIFICABLE."""
    if not isinstance(document, str) or kind not in {"matrix", "contrast"}:
        raise ValueError("UNKNOWN: fuente de auditoría inválida")
    found: dict[str, tuple[str, ...]] = {}
    for key, prefix in GAPS.items():
        header = "| " + key + (" ·" if kind == "matrix" else " |")
        matches = [line for line in document.splitlines() if line.startswith(header)]
        if len(matches) != 1:
            raise ValueError("UNKNOWN: fila ausente o duplicada " + key)
        fields = tuple(value.strip() for value in matches[0].strip("|").split("|"))
        if len(fields) != 5 or not all(fields):
            raise ValueError("UNKNOWN: fila incompleta " + key)
        if kind == "matrix":
            valid = (fields[0] == key + " · README.md"
                     and fields[1].startswith(prefix)
                     and fields[2] == "NO_VERIFICABLE"
                     and "Contraste #292" in fields[3]
                     and "Estado operativo: UNKNOWN" in fields[3]
                     and "Falta evidencia específica para " + key in fields[3])
        else:
            valid = (fields[0] == key and fields[1].startswith("README.md — " + prefix)
                     and fields[3] == "NO_VERIFICABLE"
                     and "Falta evidencia específica para " + key in fields[4]
                     and "tests/test_matriz_cobertura.py" in fields[2])
        if not valid:
            raise ValueError("UNKNOWN: deriva de fila " + key)
        found[key] = fields
    return found


def read_section(document: object, heading: str) -> str:
    """No aceptar secciones duplicadas ni inferir contenido fuera de la sección."""
    if not isinstance(document, str) or document.splitlines().count(heading) != 1:
        return ""
    return document.split(heading, 1)[1].split("\n## ", 1)[0]


def classify_local(key: object, sources: object) -> str:
    """Señales técnicas limitadas: jamás certifican instalación ni browser."""
    if key not in GAPS or not isinstance(sources, dict):
        return UNKNOWN
    required = ("readme", "popup", "background", "tab")
    if any(not isinstance(sources.get(name), str) or not sources[name].strip()
           for name in required):
        return UNKNOWN
    readme = sources["readme"]
    popup = sources["popup"]
    background = sources["background"]
    tab = sources["tab"]
    tab_section = read_section(readme, "## Estado local por pestaña")
    log_section = read_section(readme, "## Log de diagnóstico")
    tab_contract = (
        "SIN_AVANCE" in tab and "UNKNOWN" in tab
        and "classifyTabProgress" in tab and "module.exports" in tab
    )
    # Existing popup label is a synthetic display, NOT a connected tab list.
    preview = (
        "LOCAL_PROGRESS_VIEW_START" in popup
        and "renderLocalTabProgress();" in popup
        and "local-progress-status" in popup
        and "textContent = LOCAL_PROGRESS_LABELS[state]" in popup
    )
    safe_log = (
        "const MAX_ENTRIES = 300;" in background
        and "const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;" in background
        and "retainedLog.slice(-MAX_ENTRIES)" in background
        and "safeEntry(item, true)" in background
        and "safeRoute(entry?.path)" in background
        and "const DIAGNOSTIC_EVENTS = new Set" in background
        and "autopilot:get-log" in background
    )
    evidence = {
        "README-14-02": (
            tab_contract
            and "contrato puro offline" in tab_section
            and "sin interfaz, timers, almacenamiento ni integración runtime" in tab_section
        ),
        "README-14-03": (
            preview and "estado global" in tab_section
            and "no una tarjeta" in tab_section
        ),
        "README-14-04": (
            preview and tab_contract
            and "No dar por disponible ni certificado" in tab_section
        ),
        "README-15-01": (
            safe_log and "historial local acotado de eventos técnicos" in log_section
        ),
        "README-15-02": (
            safe_log and "No guarda mensajes ni contenido del chat" in log_section
            and "rutas se anonimizan por categoría" in log_section
            and "se excluyen identificadores de conversación" in log_section
        ),
    }
    return LOCAL_PARTIAL if evidence[key] else UNKNOWN


def browser_coverage(_key: object, _claims: object = None) -> str:
    """Un CI verde o una captura sintética no acreditan la extensión real."""
    return UNKNOWN


@lru_cache(maxsize=3)
def run_offline_node(suite: str) -> str:
    """Ejecuta solo dos harnesses existentes; sin red, perfiles ni Chrome."""
    if suite not in {TAB_RUNNER, LOG_RUNNER}:
        raise ValueError("UNKNOWN: suite no permitida")
    node = shutil.which("node")
    if node is None:
        raise AssertionError("UNKNOWN: Node no disponible")
    command = [node, str(ROOT / suite)]
    result = subprocess.run(
        command, cwd=ROOT, capture_output=True, text=True,
        check=False, timeout=65,
    )
    if result.returncode:
        raise AssertionError("UNKNOWN: suite offline falló: " + suite)
    return result.stdout


class BrechasAutofactory34Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.matrix_text = MATRIX.read_text(encoding="utf-8")
        cls.contrast_text = CONTRAST.read_text(encoding="utf-8")
        cls.matrix = coverage_rows(cls.matrix_text, "matrix")
        cls.contrast = coverage_rows(cls.contrast_text, "contrast")
        cls.sources = {
            "readme": README.read_text(encoding="utf-8"),
            "popup": POPUP.read_text(encoding="utf-8"),
            "background": BACKGROUND.read_text(encoding="utf-8"),
            "tab": TAB_MODULE.read_text(encoding="utf-8"),
        }

    def test_contrato_principal(self) -> None:
        """AC-01: cinco aserciones distintas y harnesses Node ejecutables."""
        self.assertEqual(set(self.matrix), set(GAPS))
        self.assertEqual(set(self.contrast), set(GAPS))
        for key in GAPS:
            with self.subTest(id=key):
                self.assertEqual(self.matrix[key][2], "NO_VERIFICABLE")
                self.assertEqual(self.contrast[key][3], "NO_VERIFICABLE")
                self.assertEqual(classify_local(key, self.sources), LOCAL_PARTIAL)
                self.assertEqual(browser_coverage(key), UNKNOWN)
        self.assertIn("2 offline acceptance test(s) passed", run_offline_node(TAB_RUNNER))
        logs = run_offline_node(LOG_RUNNER)
        self.assertIn("Diagnostic log: redaction, technical metadata and legacy export correctos", logs)
        self.assertIn("AF152-PRIVACY-OK", logs)
        self.assertIn("AF152-GETLOG-ERROR-REDACTED", logs)

    def test_falla_cerrado(self) -> None:
        """AC-02: fila ausente/repetida, fuentes inconsistentes y errores de almacenamiento."""
        first = next(line for line in self.matrix_text.splitlines()
                     if line.startswith("| README-14-02 ·"))
        for modified in (
            self.matrix_text.replace(first, "", 1),
            self.matrix_text + "\n" + first,
            self.matrix_text.replace(first, first.replace("NO_VERIFICABLE", "CUBIERTO", 1)),
        ):
            with self.assertRaisesRegex(ValueError, UNKNOWN):
                coverage_rows(modified, "matrix")
        contrast_first = next(line for line in self.contrast_text.splitlines()
                              if line.startswith("| README-15-02 |"))
        with self.assertRaisesRegex(ValueError, UNKNOWN):
            coverage_rows(self.contrast_text + "\n" + contrast_first, "contrast")
        mutations = {
            "README-14-02": ("tab", "classifyTabProgress"),
            "README-14-03": ("popup", "renderLocalTabProgress();"),
            "README-14-04": ("readme", "No dar por disponible ni certificado"),
            "README-15-01": ("background", "retainedLog.slice(-MAX_ENTRIES)"),
            "README-15-02": ("background", "safeRoute(entry?.path)"),
        }
        for key, (name, token) in mutations.items():
            with self.subTest(id=key):
                altered = dict(self.sources)
                self.assertIn(token, altered[name])
                altered[name] = altered[name].replace(token, "", 1)
                self.assertEqual(classify_local(key, altered), UNKNOWN)
        self.assertEqual(classify_local("README-15-02", {}), UNKNOWN)
        with self.assertRaisesRegex(ValueError, UNKNOWN):
            run_offline_node("external-script.cjs")

    def test_sin_datos_reales(self) -> None:
        """AC-03: harnesses locales y salidas sin secretos, PII ni contenido del chat."""
        for file in (MATRIX, CONTRAST, README, POPUP, BACKGROUND, TAB_MODULE):
            self.assertTrue(file.is_file())
        for suite in (TAB_RUNNER, LOG_RUNNER):
            output = run_offline_node(suite).lower()
            for forbidden in (
                "private-id", "old-secret", "new-secret", "legacy-token",
                "legacy chat content", "private@example.invalid",
                "authorization: bearer", "conversation_id", "session_cookie",
            ):
                with self.subTest(suite=suite, forbidden=forbidden):
                    self.assertNotIn(forbidden, output)
        self.assertEqual(browser_coverage("README-15-02", {"fixture": "synthetic"}), UNKNOWN)

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: ningún claim inventado hace CUBIERTO un caso local."""
        for key in GAPS:
            with self.subTest(id=key):
                self.assertEqual(self.matrix[key][2], "NO_VERIFICABLE")
                self.assertIn("Estado operativo: UNKNOWN", self.matrix[key][3])
                for claimed in (
                    None, "success", "CUBIERTO", LOCAL_PARTIAL,
                    {"ci": "success"}, {"popup": "connected"},
                    {"browser_smoke": "passed"}, {"live": True},
                    {"permission": "granted"}, {"diagnostic": "safe"},
                ):
                    self.assertEqual(browser_coverage(key, claimed), UNKNOWN)
        self.assertEqual(browser_coverage("README-99-99"), UNKNOWN)
        self.assertEqual(classify_local("README-99-99", self.sources), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
