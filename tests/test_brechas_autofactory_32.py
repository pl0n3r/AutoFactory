#!/usr/bin/env python3
"""AutoFactory #339: README-12-08..10 / README-13-01..02, offline only.

Local contracts are not evidence of a real Safari/Xcode installation,
browser-granted permissions or production readiness.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "UNKNOWN"
LOCAL = "CONTRATO_LOCAL_NO_INSTALACION"
MATRIX = "docs/matriz-cobertura.md"
CONTRAST = "docs/contraste-af_readme.md"
README = "README.md"
FILES = (
    MATRIX, CONTRAST, README, "AGENTES.md", "decisiones.yml",
    "learning.js", "reliability.js", "background.js", "content.js",
    "build-safari.sh", "manifest.json",
    "safari/ChatGPT Autopilot Local.xcodeproj/project.pbxproj",
)
GAPS = {
    "README-12-08": (
        "Instalación y uso — Abre safari/ChatGPT Autopilot Local.xcodeproj",
        "3. Abre " + chr(96) + "safari/ChatGPT Autopilot Local.xcodeproj" + chr(96) + ".",
    ),
    "README-12-09": (
        "Instalación y uso — En Xcode, selecciona tu equipo de firma si macOS lo solicita y pulsa Run",
        "4. En Xcode, selecciona tu equipo de firma si macOS lo solicita y pulsa **Run**.",
    ),
    "README-12-10": (
        "Instalación y uso — Abre Safari > Ajustes > Extensiones, activa ChatGPT Autopilot Local",
        "5. Abre Safari > Ajustes > Extensiones, activa **ChatGPT Autopilot Local**, permite acceso a "
        + chr(96) + "chatgpt.com" + chr(96) + " y recarga las pestañas abiertas.",
    ),
    "README-13-01": (
        "Confiabilidad y memoria adaptativa local — AutoFactory conserva muestras locales de tiempos",
        "AutoFactory conserva muestras locales de tiempos de inicio/respuesta, ciclos, recuperaciones y fallos "
        "para ajustar umbrales de detección de bloqueos.",
    ),
    "README-13-02": (
        "Confiabilidad y memoria adaptativa local — Esa memoria permanece en el navegador",
        "Esa memoria permanece en el navegador y no guarda el texto de las conversaciones.",
    ),
}

# Tests actual Node modules with invented metrics; never loads a browser, network
# client or chat transcript. A chat-text sentinel must not enter persisted state.
NODE_FIXTURE = r"""
'use strict';
const l = require('./learning.js');
const r = require('./reliability.js');
const sentinel = 'SYNTHETIC_CHAT_TEXT_NEVER_STORE';
let state = l.normalize({extra: sentinel, startupSamplesMs: [-1, 2000, Infinity]});
state = l.update(state, 'startup', 1000, {chatText: sentinel});
state = l.update(state, 'startup', 2000);
state = l.update(state, 'startup', 3000);
state = l.update(state, 'cycle', 1200);
state = l.update(state, 'recovery');
state = l.update(state, 'failure');
state = l.update(state, 'error', 0, {code: 'timeout', chatText: sentinel});
let long = l.normalize({startupSamplesMs: Array.from({length: 80}, (_,i)=>1000+i)});
let store = new Map();
let storage = {getItem: key => store.get(key) || null,
               setItem: (key, val) => store.set(key, val)};
let persisted = r.save(storage, {lastSentAt: 1000, chatText: sentinel, consecutiveFailures: 1});
let restored = r.load(storage);
let retry = r.afterFailure(restored, 10000);
let breaker = r.normalize();
for(let i=0;i<5;i++) breaker = r.afterFailure(breaker, 10000);
const report = {
  counters: [state.cycles, state.recoveries, state.failures],
  samples: state.startupSamplesMs,
  responses: state.responseSamplesMs,
  errors: state.errorsByCode,
  adaptiveTimeout: l.startupTimeoutMs(state),
  backoff: l.errorBackoffMs(state, 'timeout'),
  bounded: long.startupSamplesMs.length,
  stored: Array.from(store.values()),
  restored, persisted,
  retryAt: retry.retryAt,
  breakerUntil: breaker.circuitOpenUntil,
  unknownExtrasStored: JSON.stringify(state).includes(sentinel) ||
      JSON.stringify(restored).includes(sentinel) ||
      JSON.stringify(Array.from(store.values())).includes(sentinel),
};
process.stdout.write(JSON.stringify(report));
"""


def sources() -> dict[str, str]:
    """Read only committed local inputs, no network or personal records."""
    return {path: (ROOT / path).read_text(encoding="utf-8") for path in FILES}


def rows(raw: object, kind: str) -> dict[str, tuple[str, ...]]:
    """Fail closed for absent, ambiguous, truncated or promoted source rows."""
    if not isinstance(raw, str) or kind not in ("matrix", "contrast"):
        raise ValueError("UNKNOWN: invalid source")
    found = {}
    for ident, (expect, _) in GAPS.items():
        prefix = "| " + ident + (" ·" if kind == "matrix" else " |")
        matches = [line for line in raw.splitlines() if line.startswith(prefix)]
        if len(matches) != 1:
            raise ValueError("UNKNOWN: missing/duplicate " + ident)
        fields = tuple(part.strip() for part in matches[0].strip("|").split("|"))
        if len(fields) != 5 or not all(fields):
            raise ValueError("UNKNOWN: incomplete " + ident)
        if kind == "matrix":
            ok = (fields[0] == ident + " · README.md"
                  and fields[2] == "NO_VERIFICABLE"
                  and "Contraste #292" in fields[3]
                  and "Estado operativo: UNKNOWN" in fields[3]
                  and "Falta evidencia específica para " + ident in fields[3])
        else:
            ok = (fields[0] == ident and fields[3] == "NO_VERIFICABLE"
                  and "README.md" in fields[2]
                  and "Falta evidencia específica para " + ident in fields[4])
        if not ok or expect not in fields[1]:
            raise ValueError("UNKNOWN: stale/promoted " + ident)
        found[ident] = fields
    return found


def section(raw: str, heading: str) -> str:
    lines = raw.splitlines()
    starts = [i for i, line in enumerate(lines) if line == heading]
    if len(starts) != 1:
        return ""
    first = starts[0] + 1
    last = next((i for i in range(first, len(lines))
                 if lines[i].startswith("## ")), len(lines))
    return "\n".join(lines[first:last])


def active_decision(raw: str, ident: str) -> bool:
    try:
        items = json.loads(raw)["decisions"]
        found = [v for v in items if isinstance(v, dict) and v.get("id") == ident]
        return len(found) == 1 and found[0].get("status") == "active"
    except (TypeError, ValueError, KeyError, AttributeError):
        return False


def local_contract(ident: object, data: object) -> str:
    """Documentary/source contract, NEVER Safari installed or remotely validated."""
    if ident not in GAPS or not isinstance(data, dict):
        return UNKNOWN
    if any(not isinstance(data.get(path), str) or not data[path] for path in FILES):
        return UNKNOWN
    try:
        matrix = rows(data[MATRIX], "matrix")
        contrast = rows(data[CONTRAST], "contrast")
        manifest = json.loads(data["manifest.json"])
    except (ValueError, KeyError, TypeError):
        return UNKNOWN
    if (ident not in matrix or ident not in contrast
            or not all(active_decision(data["decisiones.yml"], d)
                       for d in ("D-060", "D-062"))
            or manifest.get("manifest_version") != 3
            or manifest.get("host_permissions") != ["https://chatgpt.com/*"]
            or "Chrome y Safari" not in data["AGENTES.md"]):
        return UNKNOWN
    heading = ("## Instalación y uso" if ident.startswith("README-12")
               else "## Confiabilidad y memoria adaptativa local")
    block = section(data[README], heading)
    if not block or block.splitlines().count(GAPS[ident][1]) != 1:
        return UNKNOWN
    if ident.startswith("README-12"):
        if ("### Instalar en Safari" not in block
                or "safari/ChatGPT Autopilot Local.xcodeproj"
                not in data["build-safari.sh"]
                or "objectVersion =" not in data[
                    "safari/ChatGPT Autopilot Local.xcodeproj/project.pbxproj"
                ]):
            return UNKNOWN
    else:
        if ("storage.local" not in data["background.js"]
                or "shared learning gate closed" not in data["background.js"]
                or "learning.update" not in data["content.js"]
                or "startupSamplesMs" not in data["learning.js"]
                or "SESSION_KEY" not in data["reliability.js"]):
            return UNKNOWN
    return LOCAL


def operational_evidence(_ident: object, _claimed: object = None) -> str:
    """No trusted GUI smoke, signing team, permission or runtime evidence here."""
    return UNKNOWN


def node_metrics() -> dict:
    result = subprocess.run(
        ["node", "-e", NODE_FIXTURE], cwd=ROOT,
        text=True, capture_output=True, check=False, timeout=15,
    )
    if result.returncode or result.stderr.strip():
        raise AssertionError("UNKNOWN: Node fixture did not execute cleanly")
    return json.loads(result.stdout)


class BrechasAutofactory32Tests(unittest.TestCase):
    def test_contrato_principal(self) -> None:
        """AC-01: each of five rows has an independent local assertion/UNKNOWN."""
        data = sources()
        self.assertEqual(set(GAPS), set(rows(data[MATRIX], "matrix")))
        self.assertEqual(set(GAPS), set(rows(data[CONTRAST], "contrast")))
        for ident in GAPS:
            with self.subTest(id=ident):
                self.assertEqual(LOCAL, local_contract(ident, data))
                self.assertEqual(UNKNOWN, operational_evidence(ident))
        self.assertIn("CODE_SIGNING_ALLOWED=NO", data["build-safari.sh"])
        self.assertIn("-project", data["build-safari.sh"])
        self.assertIn("ChatGPT Autopilot Local", data[
            "safari/ChatGPT Autopilot Local.xcodeproj/project.pbxproj"
        ])
        result = node_metrics()
        # README-13-01: actual learning module, synthetic timers and breaker.
        self.assertEqual(result["counters"], [1, 1, 1])
        self.assertEqual(result["samples"], [2000, 1000, 2000, 3000])
        self.assertEqual(result["responses"], [1200])
        self.assertEqual(result["errors"], {"timeout": 1})
        self.assertEqual(result["bounded"], 50)
        self.assertGreaterEqual(result["adaptiveTimeout"], 15000)
        self.assertLessEqual(result["adaptiveTimeout"], 90000)
        self.assertGreater(result["backoff"], 15000)
        self.assertGreater(result["retryAt"], 10000)
        self.assertGreater(result["breakerUntil"], 10000)
        # README-13-02: no chat-text in persisted local sample.
        self.assertFalse(result["unknownExtrasStored"])
        self.assertEqual(result["restored"], result["persisted"])
        self.assertEqual(len(result["stored"]), 1)

    def test_falla_cerrado(self) -> None:
        """AC-02: altered or missing documents, decisions or evidence => UNKNOWN."""
        data = sources()
        for path, kind in ((MATRIX, "matrix"), (CONTRAST, "contrast")):
            for ident in GAPS:
                with self.subTest(path=path, id=ident):
                    prefix = "| " + ident + (" ·" if kind == "matrix" else " |")
                    row = next(s for s in data[path].splitlines()
                               if s.startswith(prefix))
                    for changed in (
                        data[path].replace(row, "", 1),
                        data[path] + "\n" + row,
                        data[path].replace(
                            row, row.replace("NO_VERIFICABLE", "CUBIERTO", 1), 1
                        ),
                        data[path].replace(row, prefix + " |", 1),
                    ):
                        with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                            rows(changed, kind)
        for ident, (_, line) in GAPS.items():
            with self.subTest(source=README, id=ident):
                altered = dict(data)
                altered[README] = data[README].replace(line, "text missing", 1)
                self.assertEqual(UNKNOWN, local_contract(ident, altered))
                self.assertEqual(UNKNOWN, local_contract(ident, {}))
        revoked = json.loads(data["decisiones.yml"])
        for decision in revoked["decisions"]:
            if decision["id"] == "D-062":
                decision["status"] = "revoked"
        self.assertEqual(UNKNOWN, local_contract(
            "README-13-02", {**data, "decisiones.yml": json.dumps(revoked)}
        ))
        self.assertEqual(UNKNOWN, local_contract(
            "README-12-08", {**data, "build-safari.sh": "missing"}
        ))
        self.assertEqual(UNKNOWN, local_contract(
            "README-13-02", {**data, "background.js": ""}
        ))

    def test_sin_datos_reales(self) -> None:
        """AC-03: synthetic-only runtime samples and limited local artifacts."""
        root = ast.parse(Path(__file__).read_text(encoding="utf-8"))
        imported = {a.name.split(".")[0] for item in ast.walk(root)
                    if isinstance(item, ast.Import) for a in item.names}
        imported.update({item.module.split(".")[0] for item in ast.walk(root)
                         if isinstance(item, ast.ImportFrom) and item.module})
        self.assertFalse(imported & {
            "socket", "urllib", "requests", "httpx", "selenium", "playwright",
        })
        self.assertEqual(
            set(FILES) - {"safari/ChatGPT Autopilot Local.xcodeproj/project.pbxproj"},
            set(FILES) - {"safari/ChatGPT Autopilot Local.xcodeproj/project.pbxproj"}
        )
        result = node_metrics()
        self.assertNotIn("SYNTHETIC_CHAT_TEXT_NEVER_STORE", json.dumps(result))
        self.assertNotIn("chatText", json.dumps(result))
        self.assertFalse(result["unknownExtrasStored"])
        self.assertEqual(UNKNOWN, operational_evidence(
            "README-12-09", {"team": "claimed", "run": "claimed"}
        ))

    def test_estados_unknown_explicitos(self) -> None:
        """AC-04: docs, synthetic data and CI never confer manual GUI state."""
        data = sources()
        fakes = (
            None, {}, True, {"ci": "success"}, {"xcode": "installed"},
            {"team": "signed", "run": True},
            {"safari": "enabled", "chatgpt.com": "permitted"},
            {"memory": "local", "browser": "chrome"},
            {"smoke": "pass", "production": "green"},
        )
        for ident in GAPS:
            with self.subTest(id=ident):
                self.assertEqual(LOCAL, local_contract(ident, data))
                for fake in fakes:
                    self.assertEqual(UNKNOWN, operational_evidence(ident, fake))
        self.assertEqual(UNKNOWN, local_contract("README-13-99", data))
        self.assertEqual(UNKNOWN, operational_evidence(
            "README-13-01", node_metrics()
        ))


if __name__ == "__main__":
    unittest.main()
