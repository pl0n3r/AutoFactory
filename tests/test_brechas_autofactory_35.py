#!/usr/bin/env python3
"""#342: pruebas locales del diagnóstico README-15-03/04; nunca evidencia live.

Solo lee archivos versionados y ejecuta Node con dobles sintéticos de Chrome.
Los contratos locales no certifican instalación, permisos ni producción.
"""
from __future__ import annotations

from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "UNKNOWN"
LOCAL = "CONTRATO_LOCAL"
MATRIX = "docs/matriz-cobertura.md"
CONTRAST = "docs/contraste-af_readme.md"
README = "README.md"
CHANGELOG = "CHANGELOG.md"
BACKGROUND = "background.js"
POPUP = "popup.js"
HTML = "popup.html"
NODE_TEST = "test-background.cjs"
POPUP_TEST = "test-popup-security.cjs"
SOURCES = (MATRIX, CONTRAST, README, CHANGELOG, BACKGROUND, POPUP,
           HTML, NODE_TEST, POPUP_TEST)
GAPS = {
    "README-15-03": "Log de diagnóstico — COPIAR DIAGNÓSTICO produce una salida sanitizada y BORRAR LOG elimina la copia local",
    "README-15-04": "Log de diagnóstico — Consulta CHANGELOG.md para el detalle histórico de versiones y cambios",
}


def read_sources() -> dict[str, str]:
    return {path: (ROOT / path).read_text(encoding="utf-8") for path in SOURCES}


def rows(document: object, kind: str) -> dict[str, tuple[str, ...]]:
    """La evidencia ausente, repetida, alterada o promovida es UNKNOWN."""
    if not isinstance(document, str) or kind not in ("matrix", "contrast"):
        raise ValueError("UNKNOWN: fuente inválida")
    found = {}
    for ident, requirement in GAPS.items():
        prefix = f"| {ident} · README.md |" if kind == "matrix" else f"| {ident} |"
        matches = [line for line in document.splitlines()
                   if line.startswith(prefix)]
        if len(matches) != 1:
            raise ValueError("UNKNOWN: fila ausente o duplicada " + ident)
        cells = tuple(part.strip() for part in matches[0].strip("|").split("|"))
        if len(cells) != 5 or not all(cells) or requirement not in cells[1]:
            raise ValueError("UNKNOWN: fila incompleta " + ident)
        if kind == "matrix":
            ok = (cells[0] == f"{ident} · README.md"
                  and cells[2] == "NO_VERIFICABLE"
                  and "Contraste #292" in cells[3]
                  and f"Falta evidencia específica para {ident}" in cells[3]
                  and "Estado operativo: UNKNOWN" in cells[3])
        else:
            ok = (cells[0] == ident and cells[3] == "NO_VERIFICABLE"
                  and "README.md" in cells[2] and "tests/test_matriz_cobertura.py" in cells[2]
                  and f"Falta evidencia específica para {ident}" in cells[4])
        if not ok:
            raise ValueError("UNKNOWN: evidencia no verificable alterada " + ident)
        found[ident] = cells
    return found


def section(document: str, heading: str) -> str:
    marker = f"## {heading}\n"
    if document.count(marker) != 1:
        return ""
    return document.split(marker, 1)[1].split("\n## ", 1)[0]


def classify(ident: object, sources: object) -> str:
    """Verifica una fuente/contrato local; NUNCA da éxito a un navegador live."""
    if ident not in GAPS or not isinstance(sources, dict):
        return UNKNOWN
    if not all(isinstance(sources.get(p), str) and sources[p] for p in SOURCES):
        return UNKNOWN
    try:
        if ident not in rows(sources[MATRIX], "matrix"):
            return UNKNOWN
        if ident not in rows(sources[CONTRAST], "contrast"):
            return UNKNOWN
    except ValueError:
        return UNKNOWN
    readme_section = section(sources[README], "Log de diagnóstico")
    readme_tokens = (
        ("**COPIAR DIAGNÓSTICO**", "**BORRAR LOG**", "salida sanitizada", "copia local")
        if ident == "README-15-03"
        else ("Consulta [CHANGELOG.md](CHANGELOG.md)", "detalle histórico de versiones y cambios")
    )
    if not readme_section or any(token not in readme_section for token in readme_tokens):
        return UNKNOWN
    if ident == "README-15-04":
        if ("[CHANGELOG.md](CHANGELOG.md)" not in readme_section
                or not re.search(r"(?m)^# Historial de versiones$", sources[CHANGELOG])
                or not re.search(r"(?m)^## \d+\.\d+\.\d+ — \d{4}-\d\d-\d\d$", sources[CHANGELOG])):
            return UNKNOWN
    else:
        worker = sources[BACKGROUND]
        popup = sources[POPUP]
        html = sources[HTML]
        checks = (
            (worker, "function safeRoute("),
            (worker, "function safeEntry("),
            (worker, "function safeDetails("),
            (worker, "return '/c/:id'"),
            (worker, "'storage_unavailable'"),
            (worker, "message?.type === 'autopilot:get-log'"),
            (worker, "message?.type === 'autopilot:clear-log'"),
            (worker, "storageSet({ diagnosticLog: [] })"),
            (popup, "$('copy-log').addEventListener('click'"),
            (popup, "$('clear-log').addEventListener('click'"),
            (popup, "autopilot:get-log"),
            (popup, "autopilot:clear-log"),
            (popup, "await copyText(JSON.stringify("),
            (html, 'id="copy-log"'),
            (html, 'id="clear-log"'),
            (sources[NODE_TEST], "AF152-PRIVACY-OK"),
            (sources[NODE_TEST], "AF152-GETLOG-ERROR-REDACTED"),
            (sources[POPUP_TEST], "await window.copyText('diagnostic fallback')"),
        )
        if any(token not in source for source, token in checks):
            return UNKNOWN
        if html.count('id="copy-log"') != 1 or html.count('id="clear-log"') != 1:
            return UNKNOWN
    return LOCAL


def operational_attestation(_ident: object, _evidence: object = None) -> str:
    """Un test con dobles no certifica navegador instalado ni datos reales."""
    return UNKNOWN


# Ejecuta los handlers reales del service worker sobre almacenamiento sintético.
CLEAR_AND_REDACT = r"""
const assert = require('node:assert/strict');
const fake = 'synthetic-private-id';
const store = {diagnosticLog: [{at: new Date().toISOString(),
  event: 'failure', tabId: 8, windowId: 2, path: '/c/' + fake,
  details: {message: fake, token: fake, code: 'connection'}}]};
let handler;
global.chrome = {
  storage: {local: {
    get(defaults, cb) { cb({...defaults, ...store}); },
    set(values, cb) { Object.assign(store, values); cb?.(); }
  }},
  runtime: {onMessage: {addListener(fn) { handler = fn; }}}
};
require('./background.js');
assert.equal(typeof handler, 'function');
handler({type: 'autopilot:get-log'}, {}, first => {
  assert.equal(first.entries.length, 1);
  assert.equal(first.entries[0].path, '/c/:id');
  assert.deepEqual(first.entries[0].details, {code: 'connection'});
  assert.equal(JSON.stringify(first).includes(fake), false);
  handler({type: 'autopilot:clear-log'}, {}, cleared => {
    assert.deepEqual(cleared, {ok: true});
    handler({type: 'autopilot:get-log'}, {}, after => {
      assert.deepEqual(after.entries, []);
      assert.deepEqual(store.diagnosticLog, []);
      console.log('AF342-REDACT-CLEAR-OK');
    });
  });
});
"""


class BrechasAutofactory35Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sources = read_sources()

    def run_node(self, *args: str, marker: str) -> None:
        executable = shutil.which("node")
        self.assertIsNotNone(executable, "Node >=20 es obligatorio, no se simula éxito")
        result = subprocess.run([executable, *args], cwd=ROOT, text=True,
                                capture_output=True, timeout=40, check=False)
        output = result.stdout + "\n" + result.stderr
        self.assertEqual(result.returncode, 0, output[-5000:])
        self.assertIn(marker, result.stdout, output[-5000:])

    def test_contrato_principal(self) -> None:
        """AC-01: las dos filas y el flujo real con fixtures offline."""
        self.assertEqual(set(GAPS), set(rows(self.sources[MATRIX], "matrix")))
        self.assertEqual(set(GAPS), set(rows(self.sources[CONTRAST], "contrast")))
        for ident in GAPS:
            with self.subTest(ident=ident):
                self.assertEqual(classify(ident, self.sources), LOCAL)
        self.run_node("test-background.cjs", marker="AF152-PRIVACY-OK")
        self.run_node("test-popup-security.cjs", marker="Popup metrics: safe rendering")
        self.run_node("-e", CLEAR_AND_REDACT, marker="AF342-REDACT-CLEAR-OK")

    def test_falla_cerrado(self) -> None:
        """AC-02: corrupción, evidencia incompleta o silencio no promueven filas."""
        for ident in GAPS:
            with self.subTest(ident=ident):
                for path in SOURCES:
                    damaged = dict(self.sources)
                    damaged[path] = ""
                    self.assertEqual(classify(ident, damaged), UNKNOWN)
                for kind, path in (("matrix", MATRIX), ("contrast", CONTRAST)):
                    original = next(line for line in self.sources[path].splitlines()
                                    if line.startswith(f"| {ident} "))
                    for altered in (
                        self.sources[path].replace(original + "\n", "", 1),
                        self.sources[path] + "\n" + original,
                        self.sources[path].replace(
                            original, original.replace("NO_VERIFICABLE", "CUBIERTO"), 1),
                    ):
                        damaged = dict(self.sources)
                        damaged[path] = altered
                        self.assertEqual(classify(ident, damaged), UNKNOWN)
                altered = dict(self.sources)
                token = ("$('copy-log').addEventListener('click'" if ident.endswith("03")
                         else "[CHANGELOG.md](CHANGELOG.md)")
                path = POPUP if ident.endswith("03") else README
                altered[path] = altered[path].replace(token, "DISCONNECTED", 1)
                self.assertEqual(classify(ident, altered), UNKNOWN)
        self.assertEqual(classify("README-15-99", self.sources), UNKNOWN)
        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
            rows(None, "matrix")

    def test_sin_datos_reales(self) -> None:
        """AC-03: solo textos locales y dobles de navegador sin acceso a la red."""
        source = Path(__file__).read_text(encoding="utf-8")
        self.assertNotRegex(source, r"(?m)^(?:import|from)\s+(?:requests|httpx|socket|urllib)\b")
        self.assertNotRegex(source, r"-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----")
        self.assertNotRegex(source, r"[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
        self.assertNotIn("https://chatgpt.com/c/", source)
        self.assertIn("synthetic-private-id", CLEAR_AND_REDACT)
        self.assertEqual(tuple(self.sources), SOURCES)
        self.assertTrue(all((ROOT / path).is_file() for path in SOURCES))

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: lo local no acredita CI, navegador ni despliegue."""
        for ident in GAPS:
            with self.subTest(ident=ident):
                self.assertEqual(operational_attestation(ident, self.sources), UNKNOWN)
                self.assertEqual(classify(ident, self.sources), LOCAL)
                original = next(line for line in self.sources[MATRIX].splitlines()
                                if line.startswith(f"| {ident} "))
                altered = dict(self.sources)
                altered[MATRIX] = altered[MATRIX].replace(
                    original, original.replace("Estado operativo: UNKNOWN", "Estado operativo: LIVE"), 1)
                self.assertEqual(classify(ident, altered), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
