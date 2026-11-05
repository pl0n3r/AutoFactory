#!/usr/bin/env python3
"""AutoFactory #451: inventario fail-closed de 40 afirmaciones (solo offline)."""
from __future__ import annotations

import ast
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
REPORT = ROOT / "docs/verificacion/verificacion-02.md"
CASES = json.loads(r'''[{"id":"README-09-05","heading":"Roadmap y fuentes de verdad","anchor":"PLAN-AGENTES.md","source":"AGENTES.md","needle":"PLAN-AGENTES.md","witness":"tests/test_readme_contract_adoption.py","grade":"C_DECLARATIVA","gap":"La referencia documental es verificable; su autoridad dinámica requiere consulta a Factory main antes de cada tarea."},{"id":"README-10-01","heading":"Desarrollo local","anchor":"npm ci --ignore-scripts --no-audit --no-fund","source":"package.json","needle":"\"test\":","witness":"tests/test_readme_contract_adoption.py","grade":"A_PARCIAL","gap":"El script está versionado; no demuestra el resultado npm en un equipo real."},{"id":"README-10-02","heading":"Desarrollo local","anchor":"./build-safari.sh","source":"build-safari.sh","needle":"xcodebuild","witness":"tests/test_safari_build_smoke.py","grade":"B_EXTERNA","gap":"Falta compilación e instalación real Safari con macOS y Xcode autorizado."},{"id":"README-10-03","heading":"Desarrollo local","anchor":"No se requieren credenciales reales","source":"package.json","needle":"\"test\":","witness":"tests/test_readme_contract_adoption.py","grade":"A_PARCIAL","gap":"El script está versionado; no demuestra el resultado npm en un equipo real."},{"id":"README-11-01","heading":"Mapa de la fábrica","anchor":"Factory","source":"README.md","needle":"## Mapa de la fábrica","witness":"tests/test_readme_contract_adoption.py","grade":"C_DECLARATIVA","gap":"El mapa de funciones de Factory es declarativo y no acredita conectividad ni autoridad de un actor externo."},{"id":"README-11-02","heading":"Mapa de la fábrica","anchor":"ControlBot","source":"README.md","needle":"## Mapa de la fábrica","witness":"tests/test_readme_contract_adoption.py","grade":"C_DECLARATIVA","gap":"El mapa de funciones de Factory es declarativo y no acredita conectividad ni autoridad de un actor externo."},{"id":"README-11-03","heading":"Mapa de la fábrica","anchor":"FactoryRunner","source":"README.md","needle":"## Mapa de la fábrica","witness":"tests/test_readme_contract_adoption.py","grade":"C_DECLARATIVA","gap":"El mapa de funciones de Factory es declarativo y no acredita conectividad ni autoridad de un actor externo."},{"id":"README-11-04","heading":"Mapa de la fábrica","anchor":"Condor / GrindFlow / BRVTAL","source":"README.md","needle":"## Mapa de la fábrica","witness":"tests/test_readme_contract_adoption.py","grade":"C_DECLARATIVA","gap":"El mapa de funciones de Factory es declarativo y no acredita conectividad ni autoridad de un actor externo."},{"id":"README-11-05","heading":"Mapa de la fábrica","anchor":"AutoFactory","source":"README.md","needle":"## Mapa de la fábrica","witness":"tests/test_readme_contract_adoption.py","grade":"C_DECLARATIVA","gap":"El mapa de funciones de Factory es declarativo y no acredita conectividad ni autoridad de un actor externo."},{"id":"README-12-01","heading":"Instalación y uso","anchor":"chrome://extensions","source":"manifest.json","needle":"\"manifest_version\": 3","witness":"tests/test_readme_contract_adoption.py","grade":"B_EXTERNA","gap":"Falta instalación real y smoke de Chrome en perfil con consentimiento."},{"id":"README-12-02","heading":"Instalación y uso","anchor":"Modo de desarrollador","source":"manifest.json","needle":"\"manifest_version\": 3","witness":"tests/test_readme_contract_adoption.py","grade":"B_EXTERNA","gap":"Falta instalación real y smoke de Chrome en perfil con consentimiento."},{"id":"README-12-03","heading":"Instalación y uso","anchor":"Cargar descomprimida","source":"manifest.json","needle":"\"manifest_version\": 3","witness":"tests/test_readme_contract_adoption.py","grade":"B_EXTERNA","gap":"Falta instalación real y smoke de Chrome en perfil con consentimiento."},{"id":"README-12-04","heading":"Instalación y uso","anchor":"carpeta raíz","source":"manifest.json","needle":"\"manifest_version\": 3","witness":"tests/test_readme_contract_adoption.py","grade":"B_EXTERNA","gap":"Falta instalación real y smoke de Chrome en perfil con consentimiento."},{"id":"README-12-05","heading":"Instalación y uso","anchor":"Recarga las pestañas","source":"manifest.json","needle":"\"manifest_version\": 3","witness":"tests/test_readme_contract_adoption.py","grade":"B_EXTERNA","gap":"Falta instalación real y smoke de Chrome en perfil con consentimiento."},{"id":"README-12-06","heading":"Instalación y uso","anchor":"Clona el repositorio","source":"build-safari.sh","needle":"xcodebuild","witness":"tests/test_safari_project_bundle.py","grade":"B_EXTERNA","gap":"Falta ejecución nativa macOS/Xcode, firma si aplica y smoke de Safari instalado."},{"id":"README-12-07","heading":"Instalación y uso","anchor":"./build-safari.sh","source":"build-safari.sh","needle":"xcodebuild","witness":"tests/test_safari_project_bundle.py","grade":"B_EXTERNA","gap":"Falta ejecución nativa macOS/Xcode, firma si aplica y smoke de Safari instalado."},{"id":"README-12-08","heading":"Instalación y uso","anchor":"safari/ChatGPT Autopilot Local.xcodeproj","source":"build-safari.sh","needle":"xcodebuild","witness":"tests/test_safari_project_bundle.py","grade":"B_EXTERNA","gap":"Falta ejecución nativa macOS/Xcode, firma si aplica y smoke de Safari instalado."},{"id":"README-12-09","heading":"Instalación y uso","anchor":"equipo de firma","source":"build-safari.sh","needle":"xcodebuild","witness":"tests/test_safari_project_bundle.py","grade":"B_EXTERNA","gap":"Falta ejecución nativa macOS/Xcode, firma si aplica y smoke de Safari instalado."},{"id":"README-12-10","heading":"Instalación y uso","anchor":"Safari > Ajustes > Extensiones","source":"build-safari.sh","needle":"xcodebuild","witness":"tests/test_safari_project_bundle.py","grade":"B_EXTERNA","gap":"Falta ejecución nativa macOS/Xcode, firma si aplica y smoke de Safari instalado."},{"id":"README-13-01","heading":"Confiabilidad y memoria adaptativa local","anchor":"muestras locales","source":"adaptive-recovery.js","needle":"ChatGPTAutopilotAdaptiveRecovery","witness":"tests/test_cobertura_autofactory_09.py","grade":"A_PARCIAL","gap":"El contrato de fuentes y fixtures es local; falta observación de la recuperación o memoria en navegador instalado."},{"id":"README-13-02","heading":"Confiabilidad y memoria adaptativa local","anchor":"no guarda el texto de las conversaciones","source":"content.js","needle":"learning","witness":"tests/test_autopilot_send_diagnostic_privacy.py","grade":"A_PARCIAL","gap":"El contrato de fuentes y fixtures es local; falta observación de la recuperación o memoria en navegador instalado."},{"id":"README-13-03","heading":"Confiabilidad y memoria adaptativa local","anchor":"conexiones interrumpidas","source":"recovery-incident.js","needle":"ChatGPTAutopilotRecoveryIncident","witness":"tests/test_cobertura_autofactory_09.py","grade":"A_PARCIAL","gap":"El contrato de fuentes y fixtures es local; falta observación de la recuperación o memoria en navegador instalado."},{"id":"README-13-04","heading":"Confiabilidad y memoria adaptativa local","anchor":"envíos pendientes","source":"content.js","needle":"retry","witness":"tests/test_cobertura_autofactory_09.py","grade":"A_PARCIAL","gap":"El contrato de fuentes y fixtures es local; falta observación de la recuperación o memoria en navegador instalado."},{"id":"README-13-05","heading":"Confiabilidad y memoria adaptativa local","anchor":"desplazamiento progresivo","source":"content.js","needle":"scroll","witness":"tests/test_cobertura_autofactory_09.py","grade":"A_PARCIAL","gap":"El contrato de fuentes y fixtures es local; falta observación de la recuperación o memoria en navegador instalado."},{"id":"README-13-06","heading":"Confiabilidad y memoria adaptativa local","anchor":"Reintentar","source":"content.js","needle":"retry","witness":"tests/test_cobertura_autofactory_09.py","grade":"A_PARCIAL","gap":"El contrato de fuentes y fixtures es local; falta observación de la recuperación o memoria en navegador instalado."},{"id":"README-14-01","heading":"Estado local por pestaña","anchor":"SIN AVANCE","source":"local-tab-progress.js","needle":"SIN_AVANCE","witness":"tests/test_local_tab_progress.py","grade":"A_PARCIAL","gap":"El clasificador puro no certifica integración real del badge, popup o timers del navegador."},{"id":"README-14-02","heading":"Estado local por pestaña","anchor":"#247","source":"local-tab-progress.js","needle":"SIN_AVANCE","witness":"tests/test_local_tab_progress.py","grade":"B_EXTERNA","gap":"El README dice que PR #247 no se fusionó, pero GitHub muestra merged; debe corregirse mediante claim de README.md."},{"id":"README-14-03","heading":"Estado local por pestaña","anchor":"▶ PLAY · ACTIVAR","source":"popup.js","needle":"active","witness":"tests/test_popup_identidad.py","grade":"A_PARCIAL","gap":"El popup local no equivale a telemetría por pestaña acreditada en Chrome/Safari."},{"id":"README-14-04","heading":"Estado local por pestaña","anchor":"No dar por disponible","source":"local-tab-progress.js","needle":"SIN_AVANCE","witness":"tests/test_local_tab_progress.py","grade":"A_PARCIAL","gap":"El clasificador puro no certifica integración real del badge, popup o timers del navegador."},{"id":"README-15-01","heading":"Log de diagnóstico","anchor":"historial local acotado","source":"background.js","needle":"MAX_ENTRIES","witness":"tests/test_autopilot_send_diagnostic_privacy.py","grade":"A_PARCIAL","gap":"La lógica de log y redacción offline no acredita copia/borrado y privacidad en sesión real del navegador."},{"id":"README-15-02","heading":"Log de diagnóstico","anchor":"rutas se anonimizan","source":"background.js","needle":"MAX_ENTRIES","witness":"tests/test_autopilot_send_diagnostic_privacy.py","grade":"A_PARCIAL","gap":"La lógica de log y redacción offline no acredita copia/borrado y privacidad en sesión real del navegador."},{"id":"README-15-03","heading":"Log de diagnóstico","anchor":"COPIAR DIAGNÓSTICO","source":"background.js","needle":"MAX_ENTRIES","witness":"tests/test_autopilot_send_diagnostic_privacy.py","grade":"A_PARCIAL","gap":"La lógica de log y redacción offline no acredita copia/borrado y privacidad en sesión real del navegador."},{"id":"README-15-04","heading":"Log de diagnóstico","anchor":"CHANGELOG.md","source":"CHANGELOG.md","needle":"1.7.38","witness":"tests/test_readme_contract_adoption.py","grade":"C_DECLARATIVA","gap":"El historial versionado es referencia informativa, no evidencia de runtime."},{"id":"AGENTES-01-01","heading":"Capa local de la extensión","anchor":"Producto:","source":"manifest.json","needle":"\"name\": \"ChatGPT Autopilot Local\"","witness":"tests/test_readme_contract_adoption.py","grade":"C_DECLARATIVA","gap":"La norma y su código local no acreditan activación externa, operación autorizada o control completo de todos los PR."},{"id":"AGENTES-01-02","heading":"Capa local de la extensión","anchor":"Stack:","source":"package.json","needle":"\"version\":","witness":"tests/test_safari_project_bundle.py","grade":"A_PARCIAL","gap":"La norma y su código local no acreditan activación externa, operación autorizada o control completo de todos los PR."},{"id":"AGENTES-01-04","heading":"Capa local de la extensión","anchor":"Versionar solo cuando","source":"manifest.json","needle":"\"version\":","witness":"tests/test_readme_contract_adoption.py","grade":"C_DECLARATIVA","gap":"La norma y su código local no acreditan activación externa, operación autorizada o control completo de todos los PR."},{"id":"AGENTES-01-05","heading":"Capa local de la extensión","anchor":"Fuente de verdad:","source":".github/workflows/validate.yml","needle":"name: Validate / Pruebas y smoke Chrome","witness":"tests/test_validate_required_check.py","grade":"C_DECLARATIVA","gap":"La norma y su código local no acreditan activación externa, operación autorizada o control completo de todos los PR."},{"id":"AGENTES-01-06","heading":"Capa local de la extensión","anchor":"Fase:","source":"factory-control-activation.js","needle":"legal_blocked","witness":"tests/test_factory_control_pairing_audit_contract.py","grade":"A_PARCIAL","gap":"La norma y su código local no acreditan activación externa, operación autorizada o control completo de todos los PR."},{"id":"AGENTES-01-07","heading":"Capa local de la extensión","anchor":"Los módulos","source":"factory-control-activation.js","needle":"legal_blocked","witness":"tests/test_factory_control_pairing_audit_contract.py","grade":"A_PARCIAL","gap":"La norma y su código local no acreditan activación externa, operación autorizada o control completo de todos los PR."},{"id":"AGENTES-01-08","heading":"Capa local de la extensión","anchor":"Etiquetas:","source":".github/workflows/coordinacion.yml","needle":"name: Coordinación","witness":"tests/test_coordination_workflow_contract.py","grade":"C_DECLARATIVA","gap":"La norma y su código local no acreditan activación externa, operación autorizada o control completo de todos los PR."}]''')
BY_ID = {row["id"]: row for row in CASES}
GRADES = {"A_PARCIAL", "B_EXTERNA", "C_DECLARATIVA"}


def matrix_rows(text):
    found = {}
    for line in text.splitlines():
        if not line.startswith("| "):
            continue
        cells = tuple(s.strip() for s in line.strip("|").split("|"))
        if len(cells) != 5:
            continue
        key = cells[0].split(" · ", 1)[0]
        if key in BY_ID:
            if key in found:
                raise ValueError("UNKNOWN: matriz duplicada")
            found[key] = cells
    if set(found) != set(BY_ID):
        raise ValueError("UNKNOWN: matriz incompleta")
    return found


def report_rows(text):
    if text.count("## Veredictos por fila") != 1 or text.count("## Límites y regresiones") != 1:
        raise ValueError("UNKNOWN: informe ambiguo")
    body = text.split("## Veredictos por fila", 1)[1].split("## Límites y regresiones", 1)[0]
    found = {}
    for line in body.splitlines():
        if not line.startswith("| "):
            continue
        cells = tuple(s.strip() for s in line.strip("|").split("|"))
        if not cells or cells[0] not in BY_ID:
            continue
        if len(cells) != 8 or cells[0] in found:
            raise ValueError("UNKNOWN: informe duplicado o truncado")
        found[cells[0]] = cells
    if set(found) != set(BY_ID):
        raise ValueError("UNKNOWN: informe incompleto")
    return found


def section(text, title):
    lines = text.splitlines()
    positions = [i for i, line in enumerate(lines) if line == "## " + title]
    if len(positions) != 1:
        return None
    start = positions[0] + 1
    end = next((i for i in range(start, len(lines)) if lines[i].startswith("## ")), len(lines))
    return "\n".join(lines[start:end])


def witness_asserts(text):
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return False
    for cls in (x for x in tree.body if isinstance(x, ast.ClassDef)):
        for method in (x for x in cls.body if isinstance(x, ast.FunctionDef) and x.name.startswith("test_")):
            if any(
                isinstance(x, ast.Assert) or (
                    isinstance(x, ast.Call) and isinstance(x.func, ast.Attribute)
                    and x.func.attr.startswith("assert")
                    and isinstance(x.func.value, (ast.Name, ast.Attribute))
                ) for x in ast.walk(method)
            ):
                return True
    return False


def validate(matrix, report, files):
    if len(CASES) != 40 or len(BY_ID) != 40:
        raise ValueError("UNKNOWN: no hay cuarenta filas únicas")
    original, rows = matrix_rows(matrix), report_rows(report)
    for c in CASES:
        key = c["id"]
        if original[key][2] != "NO_VERIFICABLE" or c["grade"] not in GRADES:
            raise ValueError("UNKNOWN: estado/promoción no acreditado " + key)
        norm = "README.md" if key.startswith("README-") else "AGENTES.md"
        scope = section(files.get(norm, ""), c["heading"])
        if scope is None or c["anchor"] not in scope:
            raise ValueError("UNKNOWN: ancla normativa ausente " + key)
        if c["needle"] not in files.get(c["source"], ""):
            raise ValueError("UNKNOWN: código o workflow no verificable " + key)
        if not witness_asserts(files.get(c["witness"], "")):
            raise ValueError("UNKNOWN: testigo sin aserciones AST " + key)
        if len(c["gap"]) < 60:
            raise ValueError("UNKNOWN: brecha insuficiente " + key)
        t = chr(96)
        expected = (key, "NO_VERIFICABLE", c["grade"], t+c["heading"]+t,
                    t+c["anchor"]+t, t+c["source"]+t+" · "+t+c["needle"]+t,
                    t+c["witness"]+t, c["gap"])
        if rows[key] != expected:
            raise ValueError("UNKNOWN: evidencia reportada distinta " + key)


class VerificacionAutofactory02Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.matrix = MATRIX.read_text(encoding="utf-8")
        cls.report = REPORT.read_text(encoding="utf-8")
        paths = {"README.md", "AGENTES.md"}
        paths.update(c["source"] for c in CASES)
        paths.update(c["witness"] for c in CASES)
        cls.files = {p: (ROOT / p).read_text(encoding="utf-8") for p in paths}

    def test_cuarenta_filas_y_predicados_exactos(self):
        validate(self.matrix, self.report, self.files)
        self.assertEqual(len(matrix_rows(self.matrix)), 40)
        self.assertEqual(len(report_rows(self.report)), 40)

    def test_regresiones_negativas_informe_y_estado(self):
        line = next(x for x in self.report.splitlines() if x.startswith("| README-09-05 |"))
        for altered in (
            self.report.replace(line+"\n", "", 1),
            self.report.replace(line, line+"\n"+line, 1),
            self.report.replace(line, line.replace("NO_VERIFICABLE", "CUBIERTO"), 1),
            self.report.replace(line, line.replace("README-09-05", "README-99-99"), 1),
            self.report.replace(line, line.replace("test_readme_contract_adoption", "test_ficticio"), 1),
        ):
            with self.assertRaises(ValueError):
                validate(self.matrix, altered, self.files)
        old = next(x for x in self.matrix.splitlines() if x.startswith("| README-09-05 · "))
        with self.assertRaises(ValueError):
            validate(self.matrix.replace(old, old.replace("NO_VERIFICABLE", "CUBIERTO", 1), 1),
                     self.report, self.files)

    def test_regresiones_negativas_norma_codigo_y_testigo(self):
        c = CASES[0]
        bad = dict(self.files)
        bad["README.md"] = bad["README.md"].replace("## "+c["heading"], "## Sección eliminada", 1)
        with self.assertRaises(ValueError):
            validate(self.matrix, self.report, bad)
        bad = dict(self.files)
        bad[c["source"]] = bad[c["source"]].replace(c["needle"], "invalidado", 1)
        with self.assertRaises(ValueError):
            validate(self.matrix, self.report, bad)
        bad = dict(self.files)
        bad[c["witness"]] = "class T:\n    def test_fake(self):\n        message = 'self.assertEqual(1,1)'\n"
        with self.assertRaises(ValueError):
            validate(self.matrix, self.report, bad)

    def test_regresiones_ejecutadas_sin_datos_reales(self):
        names = [
            "tests.test_readme_contract_adoption.ReadmeContractAdoptionTests.test_factory_map_preserves_roles",
            "tests.test_local_tab_progress.LocalTabProgressTests.test_fresh_activity_resets_state_and_excludes_chat_payload",
            "tests.test_autopilot_send_diagnostic_privacy.AutopilotSendDiagnosticPrivacyTests.test_sensitive_fields_and_malformed_nested_input_are_rejected",
        ]
        suite = unittest.defaultTestLoader.loadTestsFromNames(names)
        result = unittest.TestResult()
        suite.run(result)
        self.assertEqual(result.testsRun, 3)
        self.assertFalse(result.failures, str(result.failures)[-800:])
        self.assertFalse(result.errors, str(result.errors)[-800:])

    def test_frontera_operativa_y_documental(self):
        self.assertEqual(BY_ID["README-14-02"]["grade"], "B_EXTERNA")
        self.assertIn("PR #247", self.report)
        self.assertNotIn("| CUBIERTO |", self.report)
        self.assertFalse(witness_asserts("class T:\n    def test_x(self):\n        'assertTrue'\n"))


if __name__ == "__main__":
    unittest.main()
