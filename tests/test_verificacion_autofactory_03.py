"""AutoFactory #452 — audit 03/04: exactly 40 local-only assertions.

All source and regression evidence is read from the repository checkout.
This suite makes NO claims about runtime, external API, Safari installation or
remote ControlBot authority. No credentials, network requests or release writes.
"""
from __future__ import annotations

import ast
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "docs/verificacion/verificacion-03.md"
MATRIX = ROOT / "docs/matriz-cobertura.md"
AGENTS = ROOT / "AGENTES.md"
PROTOCOL = ROOT / "docs/factory-control-protocol.md"
CONTRAST_AGENTS = ROOT / "docs/contraste-af_agentes.md"
CONTRAST_PROTO = ROOT / "docs/contraste-af_proto.md"
TICK = chr(96)

AGENT_IDS = (
    "AGENTES-01-09", "AGENTES-01-10", "AGENTES-01-11", "AGENTES-01-12",
    "AGENTES-01-13", "AGENTES-01-14", "AGENTES-01-17",
    "AGENTES-01-20", "AGENTES-01-22", "AGENTES-02-01",
    "AGENTES-02-02", "AGENTES-02-03",
)
PROTO_IDS = tuple("PROTO-%02d" % n for n in range(1, 29))
IDS = frozenset(AGENT_IDS + PROTO_IDS)

AGENT_ANCHORS = {
    "AGENTES-01-09": "Un tipo, una prioridad y un estado por Issue y PR",
    "AGENTES-01-10": "Ramas:",
    "AGENTES-01-11": "Recuperar PR existente antes de abrir otro",
    "AGENTES-01-12": "Checks:",
    "AGENTES-01-13": "Un CI verde sin smoke NO acredita",
    "AGENTES-01-14": "Entrega reversible:",
    "AGENTES-01-17": "Toda modificación de tratamientos personales exige actualizar",
    "AGENTES-01-20": "Production green de AutoFactory:",
    "AGENTES-01-22": "El log asociado queda limitado a 200 eventos",
    "AGENTES-02-01": "Serializa cambios en",
    "AGENTES-02-02": "Máximo diez commits por PR",
    "AGENTES-02-03": "Deja evidencia y bloqueos en GitHub",
}
EXISTING_PAIR = re.compile(r"^" + TICK + r"([^" + TICK + r"]+)" + TICK
                           + r"; " + TICK + r"([^" + TICK + r"]+)" + TICK + r"$")


def rows(text: str, is_report: bool = False) -> dict[str, list[str]]:
    if is_report:
        if text.count("## Veredictos por fila") != 1 or text.count("## Límites y continuación") != 1:
            raise ValueError("Secciones de informe ausentes o duplicadas")
        text = text.split("## Veredictos por fila", 1)[1].split("## Límites y continuación", 1)[0]
    result = {}
    for line in text.splitlines():
        if not line.startswith("| "):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        key = cells[0].split(" · ", 1)[0]
        if key not in IDS:
            continue
        if key in result:
            raise ValueError("Identificador duplicado: " + key)
        if len(cells) != (6 if is_report else 5):
            raise ValueError("Esquema de fila incorrecto: " + key)
        result[key] = cells
    return result


def validate(report: str, matrix: str, agents: str, protocol: str,
             contrast_agents: str, contrast_proto: str, root: Path = ROOT) -> None:
    found, inventory = rows(report, True), rows(matrix)
    a, p = rows(contrast_agents), rows(contrast_proto)
    if set(found) != IDS or set(inventory) != IDS:
        raise ValueError("Lote incompleto: 40 identificadores canónicos")
    if len(AGENT_IDS) != 12 or len(PROTO_IDS) != 28:
        raise ValueError("Distribución incorrecta")

    for key in AGENT_IDS + PROTO_IDS:
        result, item = found[key], inventory[key]
        prior = a.get(key) if key in AGENT_IDS else p.get(key)
        if prior is None:
            raise ValueError("Falta contraste precedente: " + key)
        match = EXISTING_PAIR.fullmatch(prior[2])
        if match is None:
            raise ValueError("Contraste sin par código/prueba: " + key)
        code_path, test_path = match.groups()
        source = "AGENTES.md" if key in AGENT_IDS else "docs/factory-control-protocol.md"
        if result[1:5] != [
            TICK + source + TICK,
            TICK + code_path + TICK,
            TICK + test_path + TICK,
            "NO_VERIFICABLE",
        ]:
            raise ValueError("Fuente, evidencia o estado falso: " + key)
        if item[2] != "NO_VERIFICABLE" or prior[3] != "NO_VERIFICABLE":
            raise ValueError("Promoción sin recibo auténtico: " + key)
        if len(result[5]) < 28 or result[5] != prior[4]:
            raise ValueError("Brecha incompleta o distinta: " + key)
        if key in AGENT_IDS and AGENT_ANCHORS[key] not in agents:
            raise ValueError("Norma de agentes retirada: " + key)
        if key in PROTO_IDS and ("## " + item[1]) not in protocol:
            raise ValueError("Sección de protocolo retirada: " + key)
        paths = (code_path, test_path)
        for path in paths:
            target = (root / path).resolve()
            if not target.is_relative_to(root.resolve()) or not target.is_file():
                raise ValueError("Prueba o fuente inexistente: " + key)
        code = (root / code_path).read_text(encoding="utf-8")
        if len(code.strip()) < 80:
            raise ValueError("Fuente vacía: " + key)
        probe = (root / test_path).read_text(encoding="utf-8")
        syntax = ast.parse(probe, filename=test_path)
        functions = [x for x in ast.walk(syntax)
                     if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef))
                     and x.name.startswith("test_")]
        asserts = [x for x in ast.walk(syntax) if isinstance(x, ast.Assert) or
                   (isinstance(x, ast.Call) and isinstance(x.func, ast.Attribute)
                    and x.func.attr.startswith("assert"))]
        if not functions or not asserts:
            raise ValueError("Test preexistente no tiene aserción: " + key)


class VerificacionAutofactory03Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = tuple(p.read_text(encoding="utf-8") for p in
                           (REPORT, MATRIX, AGENTS, PROTOCOL, CONTRAST_AGENTS, CONTRAST_PROTO))

    def test_40_filas_con_asercion_trazable(self):
        validate(*self.inputs)
        report = rows(self.inputs[0], True)
        self.assertEqual(40, len(report))
        self.assertEqual(12, sum(k in AGENT_IDS for k in report))
        self.assertEqual(28, sum(k in PROTO_IDS for k in report))
        for key in AGENT_IDS + PROTO_IDS:
            with self.subTest(id=key):
                self.assertEqual("NO_VERIFICABLE", report[key][4])
                self.assertTrue(report[key][3].startswith(TICK + "tests/test_"))

    def test_mutaciones_sinteticas_fallan_cerrado(self):
        original = self.inputs[0]
        variations = (
            original.replace("| PROTO-28 |", "| PROTO-27 |", 1),
            original.replace("| AGENTES-01-09 |", "| AGENTES-01-99 |", 1),
            original.replace("| NO_VERIFICABLE |", "| CUBIERTO |", 1),
            original.replace(TICK + "factory-control-ledger.js" + TICK,
                             TICK + "factory-control-missing.js" + TICK, 1),
            original.replace(TICK + "tests/test_factory_control_local_commands.py" + TICK,
                             TICK + "tests/test_absent.py" + TICK, 1),
            original.replace(
                "No se acreditó durable ledger real en todas las interrupciones del service worker.",
                "OK", 1),
        )
        for index, changed in enumerate(variations):
            with self.subTest(case=index):
                self.assertNotEqual(original, changed)
                with self.assertRaises(ValueError):
                    validate(changed, *self.inputs[1:])

    def test_contrato_node_real_deniega_texto_y_reintentos_invalidos(self):
        """Use real committed JS; synthetic fixtures never cause external I/O."""
        js = r"""
const assert = require('node:assert/strict');
const p = require('./factory-control-protocol.js');
const good = p.command({id:'synth01', action:'pause', target:'all'});
assert.equal(good.kind, 'command');
assert.equal(good.action, 'pause');
assert.throws(() => p.command({id:'synth01', action:'send_message', target:1,
  payload:{text:'SYNTHETIC_PRIVATE', secret:'DENIED'}}));
assert.throws(() => p.command({id:'synth01', action:'send_message', target:'all',
  payload:{text:'SYNTHETIC_PRIVATE'}}));
assert.throws(() => p.heartbeat({profileAlias:'fixture', accountAlias:'fixture',
  tabs:[], lastEvent:null, chatContent:'SYNTHETIC_PRIVATE'}));
const h = p.heartbeat({profileAlias:'fixture', accountAlias:'fixture',
  tabs:[], lastEvent:null});
assert.equal(h.kind, 'heartbeat');
assert.equal(JSON.stringify(h).includes('SYNTHETIC_PRIVATE'), false);
assert.throws(() => p.acknowledgement({id:'synth01', ok:true,
  code:'unauthorized'}));
process.stdout.write('synthetic contract denied invalid/private data\n');
"""
        done = subprocess.run(["node", "-e", js], cwd=ROOT,
                              capture_output=True, text=True,
                              check=False, timeout=30)
        self.assertEqual(0, done.returncode, done.stderr[-500:])
        self.assertIn("synthetic contract denied", done.stdout)
        self.assertNotIn("SYNTHETIC_PRIVATE", done.stdout)

    def test_no_promocion_sin_smoke_ni_autorizacion(self):
        report = rows(self.inputs[0], True)
        self.assertTrue(all(x[4] == "NO_VERIFICABLE" for x in report.values()))
        self.assertIn("sin transporte activo", self.inputs[3])
        self.assertIn("Un CI verde sin smoke NO acredita", self.inputs[2])
        self.assertIn("40/40 filas", self.inputs[0])
        self.assertIn("no prueba suficiente de instalación", self.inputs[0])


if __name__ == "__main__":
    unittest.main()
