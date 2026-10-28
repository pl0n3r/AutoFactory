#!/usr/bin/env python3
"""AutoFactory #340: five README coverage gaps. Offline, synthetic only.

Local tests cannot prove Chrome/Safari runtime, installation, or tab UI.
Those operational claims remain explicitly UNKNOWN.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "UNKNOWN"
LOCAL = "CONTRATO_LOCAL_NO_RUNTIME"
MATRIX = "docs/matriz-cobertura.md"
CONTRAST = "docs/contraste-af_readme.md"
README = "README.md"
CONTENT = "content.js"
RELIABILITY = "reliability.js"
ADAPTIVE = "adaptive-recovery.js"
POPUP = "popup.js"
POPUP_HTML = "popup.html"
SOURCES = (MATRIX, CONTRAST, README, CONTENT, RELIABILITY, ADAPTIVE, POPUP, POPUP_HTML)
GAPS = {
    "README-13-03": (
        "Confiabilidad y memoria adaptativa local — Ante conexiones interrumpidas",
        "Ante conexiones interrumpidas, espera recuperación antes de cancelar o recargar.",
    ),
    "README-13-04": (
        "Confiabilidad y memoria adaptativa local — Los envíos pendientes se conservan",
        "Los envíos pendientes se conservan de forma que reduzca duplicados y se aplica backoff/circuit breaker cuando los fallos se repiten.",
    ),
    "README-13-05": (
        "Confiabilidad y memoria adaptativa local — El seguimiento visual usa desplazamiento",
        "El seguimiento visual usa desplazamiento progresivo de contenedores relevantes y respeta pausas manuales.",
    ),
    "README-13-06": (
        "Confiabilidad y memoria adaptativa local — Las acciones automáticas permitidas",
        "Las acciones automáticas permitidas se limitan a esperas, recarga controlada, **Reintentar** y **Continuar generando**; autenticación o autorización requieren intervención humana.",
    ),
    "README-14-01": (
        "Estado local por pestaña — La señal SIN AVANCE todavía no está integrada",
        "La señal **SIN AVANCE** todavía no está integrada en el popup ni en el badge de la extensión.",
    ),
}

# Real modules, invented samples. No browser, chat transcript, network, credentials or timers.
NODE_FIXTURE = r"""
'use strict';
const r = require('./reliability.js');
const a = require('./adaptive-recovery.js');
const now = 100000;
const sentinel = 'SYNTHETIC_PROMPT_ONLY';
const saved = new Map();
const storage = {getItem: key => saved.get(key) || null,
                 setItem: (key,value) => saved.set(key,value)};
const initial = r.normalize({pendingSignature: r.signature(sentinel),
  assistantCountBeforeSend: 2, lastSentAt: now, chatText: sentinel});
r.save(storage, initial);
const restored = r.load(storage);
let failures = restored;
const retries = [];
for (let i=0; i<r.MAX_FAILURES; i++) {
  failures = r.afterFailure(failures, now);
  retries.push(failures.retryAt);
}
let reloads = r.normalize();
for (let i=0; i<r.MAX_RELOADS; i++) reloads = r.beforeReload(reloads, now);
const canReloadAtLimit = r.canReload(reloads, now);
reloads = r.beforeReload(reloads, now);
const recovering = a.chooseRecovery({problemCode:'connection',
  interfaceState:'interrupted', isResponding:true,
  defaults:{action:'reload'}, mode:'off', now});
const report = {
  restored, persisted: Array.from(saved.values()),
  backoffIncreasing: retries.every((v,i)=>i===0 || v>retries[i-1]),
  circuitOpen: failures.circuitOpenUntil>now,
  circuitRecovered: r.afterSuccess(failures).circuitOpenUntil===0,
  reloadDenied: !canReloadAtLimit && !r.canReload(reloads,now),
  sendRejected: !r.sendAccepted({composerCleared:false,messageAppeared:true,
    generationStarted:true}),
  sendAccepted: r.sendAccepted({composerCleared:true,messageAppeared:true}),
  lateSendRejected: !r.lateSendAccepted({circuitOpen:true,generating:false,
    assistantCount:2,assistantCountBeforeSend:2}),
  duplicateAvoided: !r.lateSendAccepted({circuitOpen:false,generating:true,
    assistantCount:3,assistantCountBeforeSend:2}),
  interruptedAction: recovering.action,
  exposesPrompt: Array.from(saved.values()).some(v=>v.includes(sentinel)),
};
process.stdout.write(JSON.stringify(report));
"""


def read_sources() -> dict[str, str]:
    return {name: (ROOT / name).read_text(encoding="utf-8") for name in SOURCES}


def rows(raw: object, kind: str) -> dict[str, tuple[str, ...]]:
    """A missing, duplicated, partial or promoted row cannot grant coverage."""
    if not isinstance(raw, str) or kind not in ("matrix", "contrast"):
        raise ValueError("UNKNOWN: invalid evidence source")
    result = {}
    for ident, (prefix, _) in GAPS.items():
        heading = "| " + ident + (" ·" if kind == "matrix" else " |")
        matches = [line for line in raw.splitlines() if line.startswith(heading)]
        if len(matches) != 1:
            raise ValueError("UNKNOWN: missing or duplicate " + ident)
        fields = tuple(part.strip() for part in matches[0].strip("|").split("|"))
        if len(fields) != 5 or not all(fields):
            raise ValueError("UNKNOWN: incomplete " + ident)
        if kind == "matrix":
            valid = (fields[0] == ident + " · README.md"
                     and fields[2] == "NO_VERIFICABLE"
                     and "Estado operativo: UNKNOWN" in fields[3]
                     and "Contraste #292" in fields[3]
                     and "Falta evidencia específica para " + ident in fields[3])
        else:
            valid = (fields[0] == ident and fields[3] == "NO_VERIFICABLE"
                     and "README.md" in fields[2]
                     and "Falta evidencia específica para " + ident in fields[4])
        if not valid or prefix not in fields[1]:
            raise ValueError("UNKNOWN: stale or promoted " + ident)
        result[ident] = fields
    return result


def section(raw: str, title: str) -> str:
    lines = raw.splitlines()
    starts = [i for i, line in enumerate(lines) if line == "## " + title]
    if len(starts) != 1:
        return ""
    begin = starts[0] + 1
    end = next((i for i in range(begin, len(lines))
                if lines[i].startswith("## ")), len(lines))
    return "\n".join(lines[begin:end])


def local_contract(ident: object, data: object) -> str:
    """A narrow source contract, never actual browser-readiness evidence."""
    if ident not in GAPS or not isinstance(data, dict):
        return UNKNOWN
    if any(not isinstance(data.get(p), str) or not data[p] for p in SOURCES):
        return UNKNOWN
    try:
        matrix, contrast = rows(data[MATRIX], "matrix"), rows(data[CONTRAST], "contrast")
    except ValueError:
        return UNKNOWN
    if ident not in matrix or ident not in contrast:
        return UNKNOWN
    title = ("Estado local por pestaña" if ident == "README-14-01"
             else "Confiabilidad y memoria adaptativa local")
    block = section(data[README], title)
    if not block or block.count(GAPS[ident][1]) != 1:
        return UNKNOWN
    required = {
        "README-13-03": ((CONTENT, "connectionFirstSeenAt"),
                         (CONTENT, "waitingForReconnect"),
                         (CONTENT, "core.connectionRecoveryAction")),
        "README-13-04": ((CONTENT, "pendingSignature"),
                         (CONTENT, "reliability.canReload"),
                         (RELIABILITY, "sendAccepted"),
                         (RELIABILITY, "afterFailure")),
        "README-13-05": ((CONTENT, "naturalScrollToLatest"),
                         (CONTENT, "manualScrollUntil"),
                         (CONTENT, "scrollableContainers"),
                         (CONTENT, "scrollStepMin")),
        "README-13-06": ((CONTENT, "signal.code === 'authentication'"),
                         (CONTENT, "human-required"),
                         (RELIABILITY, "canReload"),
                         (ADAPTIVE, "if(isResponding)")),
        "README-14-01": ((POPUP, "renderLocalTabProgress();"),
                         (POPUP, "SIN AVANCE · muestra sintética"),
                         (POPUP_HTML, "Vista sintética, sin datos conectados"),
                         (POPUP_HTML, 'data-state="UNKNOWN"')),
    }
    if not all(token in data[path] for path, token in required[ident]):
        return UNKNOWN
    return LOCAL


def operational_evidence(_ident: object, _asserted: object = None) -> str:
    """No trusted browser observer, so no operational verdict."""
    return UNKNOWN


def node_report() -> dict:
    run = subprocess.run(["node", "-e", NODE_FIXTURE], cwd=ROOT,
                         text=True, capture_output=True, timeout=15, check=False)
    if run.returncode or run.stderr.strip():
        raise AssertionError("UNKNOWN: synthetic Node execution failed")
    return json.loads(run.stdout)


class BrechasAutofactory33Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: independent assertions for all five rows."""
        data = read_sources()
        self.assertEqual(set(GAPS), set(rows(data[MATRIX], "matrix")))
        self.assertEqual(set(GAPS), set(rows(data[CONTRAST], "contrast")))
        for ident in GAPS:
            with self.subTest(gap=ident):
                self.assertEqual(LOCAL, local_contract(ident, data))
                self.assertEqual(UNKNOWN, operational_evidence(ident))
        report = node_report()
        # README-13-03: interrupted responding sessions wait, not blind reload.
        self.assertEqual("wait", report["interruptedAction"])
        # README-13-04: signature only, backoff, capped reloads and send evidence.
        self.assertEqual(1, report["restored"]["pendingSignature"].count(":"))
        for key in ("backoffIncreasing", "circuitOpen", "circuitRecovered",
                    "reloadDenied", "sendRejected", "sendAccepted",
                    "lateSendRejected", "duplicateAvoided"):
            self.assertTrue(report[key], key)
        # README-13-05: local manual-pause guard, not a real DOM scroll test.
        self.assertIn("Date.now() < state.manualScrollUntil", data[CONTENT])
        # README-13-06: account access is not automated.
        self.assertIn("setStatus('Intervención necesaria: inicia sesión'", data[CONTENT])
        # README-14-01: synthetic visual preview defaults to UNKNOWN.
        self.assertIn("renderLocalTabProgress();", data[POPUP])
        self.assertIn("UNKNOWN · sin fuente conectada", data[POPUP_HTML])

    def test_falla_cerrado(self) -> None:
        """AC-02: missing, duplicate, promoted and ambiguous evidence => UNKNOWN."""
        data = read_sources()
        for path, kind in ((MATRIX, "matrix"), (CONTRAST, "contrast")):
            for ident in GAPS:
                heading = "| " + ident + (" ·" if kind == "matrix" else " |")
                row = next(x for x in data[path].splitlines() if x.startswith(heading))
                for changed in (data[path].replace(row, "", 1),
                                data[path] + "\n" + row,
                                data[path].replace(row, row.replace(
                                    "NO_VERIFICABLE", "CUBIERTO", 1), 1),
                                data[path].replace(row, heading + " |", 1)):
                    with self.subTest(path=path, gap=ident):
                        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                            rows(changed, kind)
        for ident, (_, claim) in GAPS.items():
            altered = dict(data)
            altered[README] = data[README].replace(claim, "missing", 1)
            self.assertEqual(UNKNOWN, local_contract(ident, altered))
            self.assertEqual(UNKNOWN, local_contract(ident, {}))
        for ident, path, marker in (
            ("README-13-03", CONTENT, "waitingForReconnect"),
            ("README-13-04", RELIABILITY, "afterFailure"),
            ("README-13-05", CONTENT, "manualScrollUntil"),
            ("README-13-06", CONTENT, "human-required"),
            ("README-14-01", POPUP_HTML, "Vista sintética, sin datos conectados"),
        ):
            altered = dict(data)
            altered[path] = data[path].replace(marker, "removed")
            self.assertEqual(UNKNOWN, local_contract(ident, altered))

    def test_sin_datos_reales(self) -> None:
        """AC-03: local, synthetic, no network or personal-content reads."""
        syntax = ast.parse(Path(__file__).read_text(encoding="utf-8"))
        imported = {a.name.split(".")[0] for n in ast.walk(syntax)
                    if isinstance(n, ast.Import) for a in n.names}
        imported.update({n.module.split(".")[0] for n in ast.walk(syntax)
                         if isinstance(n, ast.ImportFrom) and n.module})
        self.assertFalse(imported & {
            "requests", "urllib", "socket", "httpx", "playwright", "selenium"
        })
        self.assertEqual(len(SOURCES), len(set(SOURCES)))
        self.assertTrue(all(not Path(p).is_absolute() and ".." not in Path(p).parts
                            for p in SOURCES))
        report = node_report()
        self.assertFalse(report["exposesPrompt"])
        self.assertNotIn("SYNTHETIC_PROMPT_ONLY", json.dumps(report))
        self.assertNotIn("chatText", json.dumps(report))

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: offline/source evidence never attests live browser state."""
        data = read_sources()
        claims = (None, {}, True, {"ci": "success"}, {"browser": "chrome"},
                  {"safari": "installed", "permissions": "granted"},
                  {"connection": "recovered", "reload": "success"},
                  {"tab": "SIN_AVANCE", "popup": "visible"},
                  {"user": "authenticated", "runtime": "live"})
        for ident in GAPS:
            self.assertEqual(LOCAL, local_contract(ident, data))
            for claim in claims:
                with self.subTest(gap=ident, claim=claim):
                    self.assertEqual(UNKNOWN, operational_evidence(ident, claim))
        self.assertEqual(UNKNOWN, local_contract("README-13-99", data))
        self.assertEqual(UNKNOWN, operational_evidence("README-13-03", node_report()))


if __name__ == "__main__":
    unittest.main()
