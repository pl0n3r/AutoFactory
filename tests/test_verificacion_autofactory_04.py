"""#453: 38 filas de evidencia local limitadas; NUNCA certifica producción.

La prueba ejecuta contratos versionados y usa exclusivamente fixtures sintéticos.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "docs/verificacion/verificacion-04.md"
MATRIX = ROOT / "docs/matriz-cobertura.md"
CASES = (
    ('PROTO-29', 'factory-control-local-commands.js', 'tests/test_factory_control_local_commands.py', 'B_EXTERNA', 'ac21: abortar ACK de pestaña suspendida está ejercitado solo por Node sintético; falta suspensión Chrome/Safari real.', 'Timeout de pestañas suspendidas (ac21)'),
    ('PROTO-30', 'factory-control-local-commands.js', 'tests/test_factory_control_local_commands.py', 'B_EXTERNA', 'ac22: la revocación de permiso entre envío y ACK se inyecta offline; falta host real con permiso revocado.', 'Revocación del permiso de host durante ACK (ac22)'),
    ('PROTO-31', 'factory-control-local-commands.js', 'tests/test_factory_control_local_commands.py', 'B_EXTERNA', 'ac23: tabs.query sin respuesta es fixture; falta comprobar límite en sesión/instalación real.', 'Límite de consulta de pestañas (ac23)'),
    ('DOC-OBSERVADOR-RESERVAS-V3-01', 'docs/OBSERVADOR-RESERVAS-V3.md', 'tests/test_observador_reservas_consumidor.py', 'B_EXTERNA', 'La lectura de eventos/contratos no prueba 24 horas/100 ciclos autenticados y firmados del observador.', 'Alcance y seguridad'),
    ('DOC-OBSERVADOR-RESERVAS-V3-02', 'docs/OBSERVADOR-RESERVAS-V3.md', 'tests/test_observador_reservas_consumidor.py', 'B_EXTERNA', 'Faltan leases terminales y éxito de observación procedente de GitHub autenticado.', 'Criterios operativos que aún NO se acreditan'),
    ('DOC-OBSERVADOR-RESERVAS-V3-03', 'docs/OBSERVADOR-RESERVAS-V3.md', 'tests/test_observador_reservas_consumidor.py', 'B_EXTERNA', 'No hay recibo de recuperación en un run real ni prueba remota de no auto-liberación.', 'Validación y reversión'),
    ('DOC-OFFLINE-SESSION-STATE-DENIALS-01', 'docs/OFFLINE-SESSION-STATE-DENIALS.md', 'tests/test_offline_session_state_denials.py', 'A_PARCIAL', 'Denegación fail-closed local; no habilita credenciales ni transporte real.', 'Autoridad y alcance'),
    ('DOC-OFFLINE-SESSION-STATE-DENIALS-02', 'docs/OFFLINE-SESSION-STATE-DENIALS.md', 'tests/test_offline_session_state_denials.py', 'A_PARCIAL', 'Fixtures negativos y diagnóstico minimizado; falta observación de sesión integrada autorizada.', 'Qué se comprueba'),
    ('DOC-OFFLINE-SESSION-STATE-DENIALS-03', 'docs/OFFLINE-SESSION-STATE-DENIALS.md', 'tests/test_offline_session_state_denials.py', 'C_DECLARATIVA', 'Instrucciones para ejecutar pruebas; no constituye función runtime ni evidencia de ejecución externa.', 'Ejecutar'),
    ('DOC-OFFLINE-SESSION-STATE-DENIALS-04', 'docs/OFFLINE-SESSION-STATE-DENIALS.md', 'tests/test_offline_session_state_denials.py', 'B_EXTERNA', 'Pendiente puerta legal, smoke de navegador instalado y rollback autorizado.', 'Gates pendientes y reversión'),
    ('DOC-RELEASE-EVIDENCE-01', 'docs/RELEASE-EVIDENCE.md', 'tests/test_release_artifact_attestation.py', 'B_EXTERNA', 'La proveniencia histórica del incidente #31 exige recibos de release/runner reales firmados.', 'Historical provenance incident #31'),
    ('DOC-RELEASE-EVIDENCE-02', 'docs/RELEASE-EVIDENCE.md', 'tests/test_release_artifact_attestation.py', 'B_EXTERNA', 'Recuperación de jobs en CI requiere recibos terminales, no solo aserciones de paquete local.', 'Recovery evidence'),
    ('DOC-RELEASE-EVIDENCE-03', 'docs/RELEASE-EVIDENCE.md', 'tests/test_release_artifact_attestation.py', 'A_PARCIAL', 'Gate de observación aprendizaje adaptativo 1.7.0 definido en contrato, no observado en release instalado.', '1.7.0 shared adaptive learning observation gate'),
    ('DOC-CI-EXTENSION-SECURITY-01', 'docs/ci-extension-security.md', 'tests/test_security_workflow_contract.py', 'B_EXTERNA', 'CI declarativo no certifica seguridad de runner, permisos reales, instalación y dispositivo.', 'CI de AutoFactory (adopción Factory v1)'),
    ('DOC-RELEASE-SECURITY-01', 'docs/release-security.md', 'tests/test_release_artifact_attestation.py', 'A_PARCIAL', 'Verificación de artefacto local no sustituye aprobación de publicación/instalación real.', 'Puerta de publicación de AutoFactory'),
    ('DOC-SESSION-KEEPALIVE-02', 'docs/session-keepalive.md', 'tests/test_session_keepalive_integration.py', 'A_PARCIAL', 'Keepalive sintético y guardas de concurrencia; falta evidencia de sesión Chrome/Safari real.', 'Evidencia requerida'),
    ('DOC-SONAR-CHECK-DETAILS-01', 'docs/sonar-check-details.md', 'tests/test_sonar_relay_sanitization.py', 'B_EXTERNA', 'Relé local sanitizado; falta correlacionar check SonarCloud real, PR y SHA exacto.', 'Diagnóstico SonarCloud desde GitHub'),
    ('AF1-AC-01', 'factory-control-authorization.js', 'tests/test_factory_control_pairing_public_result.py', 'B_EXTERNA', 'Pairing revocable y consentimiento autenticado no activos; depende de puerta ControlBot#20.', ''),
    ('AF1-AC-02', 'factory-control-heartbeat.js', 'tests/test_factory_control_heartbeat_presence.py', 'B_EXTERNA', 'No hay latidos de 60 s y estado offline observados en extensión instalada.', ''),
    ('AF1-AC-03', 'factory-control-executor.js', 'tests/test_factory_control_executor_audit.py', 'B_EXTERNA', 'Órdenes, firma, ACK, replay e idempotencia sin tráfico real ni autoridad legal.', ''),
    ('AF1-AC-04', 'factory-control-account-state.js', 'tests/test_factory_control_account_state.py', 'B_EXTERNA', 'Estados y límites de sesión emparejada requieren datos reales autorizados; no se simulan.', ''),
    ('AF1-AC-05', 'factory-control-runtime.js', 'tests/test_factory_control_runtime.py', 'B_EXTERNA', 'E2E AutoFactory↔ControlBot, consentimiento y puerta final no acreditados.', ''),
    ('ISSUE-258', 'docs/lista-salida-produccion.md', 'tests/test_lista_salida_produccion.py', 'B_EXTERNA', 'Checklist de salida no demuestra smoke Chrome/Safari, paquete instalable ni autorización live.', ''),
    ('ISSUE-1', 'factory-control-activation.js', 'tests/test_factory_control_readiness_report.py', 'B_EXTERNA', 'Épico remoto requiere E2E consentido y control legal ControlBot#20.', ''),
    ('ISSUE-122', 'AGENTES.md', 'tests/test_safari_project_bundle.py', 'B_EXTERNA', 'Contrato Safari no sustituye instalación Xcode ni carga GUI autenticada.', ''),
    ('ISSUE-129', 'factory-control-authorization.js', 'tests/test_factory_control_pairing_audit_contract.py', 'B_EXTERNA', 'Pairing local aislado; transporte real sigue apagado por gate legal.', ''),
    ('ISSUE-130', 'factory-control-heartbeat.js', 'tests/test_factory_control_heartbeat_presence.py', 'B_EXTERNA', 'Heartbeat local no equivale a ACK auténtico de ControlBot.', ''),
    ('ISSUE-131', 'factory-control-executor.js', 'tests/test_factory_control_executor_audit.py', 'B_EXTERNA', 'Ejecutor sólo con fixtures; falta envío y acuse con usuario autorizado.', ''),
    ('ISSUE-132', 'factory-control-account-state.js', 'tests/test_factory_control_account_state.py', 'B_EXTERNA', 'Señales locales reducidas no certifican estado de sesión del proveedor.', ''),
    ('ISSUE-133', 'factory-control-runtime.js', 'tests/test_factory_control_runtime.py', 'B_EXTERNA', 'Runtime aislado sin E2E vivo autorizado de pairing a outcome.', ''),
    ('ISSUE-134', 'docs/lista-salida-produccion.md', 'tests/test_lista_salida_produccion.py', 'B_EXTERNA', 'Go-live y puente requieren aprobación expresa de dueño y controles reales.', ''),
    ('ISSUE-216', '.github/workflows/coordinacion.yml', 'tests/test_coordination_workflow_contract.py', 'B_EXTERNA', 'El workflow está versionado pero no acredita cierre real de roadmap_partial de #129.', ''),
    ('ISSUE-219', '.github/workflows/sonar-check-details.yml', 'tests/test_sonar_relay_sanitization.py', 'B_EXTERNA', 'SonarCloud exact-main tiene Quality Gate fallido; falta remediación demostrada/decisión.', ''),
    ('DEC-D-054', 'decisiones.yml', 'tests/test_cobertura_autofactory_02.py', 'C_DECLARATIVA', 'Migración aditiva con backup es norma de productos con BD, no operación de extensión.', ''),
    ('DEC-D-055', 'decisiones.yml', 'tests/test_cobertura_autofactory_02.py', 'C_DECLARATIVA', 'Autorización acotada de escrituras de construcción no activa runtime remoto ni datos.', ''),
    ('DEC-D-057', 'decisiones.yml', 'tests/test_coordination_workflow_contract.py', 'B_EXTERNA', 'Etiquetas deben auditarse contra GitHub/PR real; un fixture no prueba enforcement.', ''),
    ('DEC-D-058', 'decisiones.yml', 'tests/test_coordination_workflow_contract.py', 'B_EXTERNA', 'Declarar roles no demuestra ejecución real de cada rol en sesiones de GitHub.', ''),
    ('DEC-D-059', 'decisiones.yml', 'tests/test_cobertura_autofactory_02.py', 'C_DECLARATIVA', 'Hostinger requiere backup y autoridad; extensión no dispone de operación de BD/hosting.', ''),
)
KINDS = {"A_PARCIAL", "B_EXTERNA", "C_DECLARATIVA"}
REAL_SUITES = (
    "tests.test_factory_control_local_commands",
    "tests.test_cobertura_autofactory_01",
    "tests.test_cobertura_autofactory_02",
    "tests.test_cobertura_autofactory_03",
    "tests.test_offline_session_state_denials",
    "tests.test_observador_reservas_consumidor",
    "tests.test_session_keepalive_integration",
    "tests.test_lista_salida_produccion",
    "tests.test_sonar_relay_sanitization",
)


def parse_rows(text: str, *, report: bool) -> dict[str, list[str]]:
    """No acepta duplicación de ID, promoción artificial ni tabla truncada."""
    if report:
        if text.count("## Veredictos por fila") != 1 or text.count(
                "## Límites, continuación y reversión") != 1:
            raise ValueError("Secciones de informe ausentes/duplicadas")
        text = text.split("## Veredictos por fila", 1)[1].split(
            "## Límites, continuación y reversión", 1)[0]
    out = {}
    valid = {case[0] for case in CASES}
    for line in text.splitlines():
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split(" | ")]
        if not report and (len(cells) != 5 or cells[0].startswith(chr(96))):
            continue
        key = cells[0].strip("`").split(" · ", 1)[0]
        if key not in valid:
            continue
        if key in out:
            raise ValueError("ID repetido: " + key)
        if len(cells) != (6 if report else 5):
            raise ValueError("Celdas inválidas: " + key)
        out[key] = cells
    if set(out) != valid:
        raise ValueError("Inventario incompleto")
    return out


def validate(report_text: str, matrix_text: str, root: Path = ROOT) -> None:
    report = parse_rows(report_text, report=True)
    matrix = parse_rows(matrix_text, report=False)
    if len(CASES) != 38 or len(report) != 38 or len(matrix) != 38:
        raise ValueError("Faltan filas de la asignación")
    for key, src, witness, kind, reason, heading in CASES:
        found, item = report[key], matrix[key]
        if item[2] != "NO_VERIFICABLE":
            raise ValueError("Matriz no acreditada: " + key)
        if found[1].replace(r"\|", "|") != item[1]:
            raise ValueError("Requisito adulterado: " + key)
        if found[2:6] != [
                "`" + src + "`", "`" + witness + "`",
                "NO_VERIFICABLE", kind + " — " + reason]:
            raise ValueError("Fuente, estado o brecha falsa: " + key)
        for path in (src, witness):
            dest = (root / path).resolve()
            if not dest.is_relative_to(root.resolve()) or not dest.is_file():
                raise ValueError("Testigo ausente/externo: " + key)
        if heading:
            doc_text = (root / ("docs/factory-control-protocol.md"
                                if key.startswith("PROTO-") else src)
                       ).read_text(encoding="utf-8")
            if re.search(r"(?m)^#{1,3} " + re.escape(heading) +
                         r"\s*$", doc_text) is None:
                raise ValueError("Título normativo perdido: " + key)
        content = (root / witness).read_text(encoding="utf-8")
        tree = ast.parse(content, filename=witness)
        if not any(isinstance(node, ast.FunctionDef) and
                   node.name.startswith("test_") for node in ast.walk(tree)):
            raise ValueError("No existe método de prueba: " + key)
    choices = json.loads((root / "decisiones.yml").read_text(encoding="utf-8"))
    actual = {item["id"]: item for item in choices["decisions"]}
    for id in ("D-054", "D-055", "D-057", "D-058", "D-059"):
        if id not in actual or actual[id]["status"] != "active":
            raise ValueError("Decisión suprimida/cambiada: " + id)


class VerificacionAutofactory04Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = REPORT.read_text(encoding="utf-8")
        cls.matrix = MATRIX.read_text(encoding="utf-8")

    def test_trazabilidad_38_filas_exactas(self):
        validate(self.report, self.matrix)
        table = parse_rows(self.report, report=True)
        self.assertEqual(38, len(table))
        self.assertEqual(5, sum(x[3] == "A_PARCIAL" for x in CASES))
        self.assertEqual(29, sum(x[3] == "B_EXTERNA" for x in CASES))
        self.assertEqual(4, sum(x[3] == "C_DECLARATIVA" for x in CASES))

    def test_mutaciones_fallan_cerrado(self):
        # Datos sintéticos: inventarios faltantes, duplicados, inventados y
        # clasificación inflada no se convierten en evidencia real.
        line = next(x for x in self.report.splitlines()
                    if x.startswith("| `PROTO-29`"))
        changes = (
            self.report.replace(line, "", 1),
            self.report.replace(line, line + chr(10) + line, 1),
            self.report.replace(line, line.replace("NO_VERIFICABLE",
                                                  "CUBIERTO", 1), 1),
            self.report.replace(line, line.replace(
                "tests/test_factory_control_local_commands.py",
                "tests/test_falso.py", 1), 1),
            self.report.replace(line, line.replace(
                "B_EXTERNA", "A_PARCIAL", 1), 1),
        )
        for i, changed in enumerate(changes):
            with self.subTest(i=i):
                self.assertNotEqual(changed, self.report)
                with self.assertRaises(ValueError):
                    validate(changed, self.matrix)
        # La matriz tampoco puede promoverse por editar un informe.
        target = next(x for x in self.matrix.splitlines()
                      if x.startswith("| PROTO-29 · "))
        tampered = target.replace("| NO_VERIFICABLE |", "| CUBIERTO |", 1)
        self.assertNotEqual(target, tampered)
        altered_matrix = self.matrix.replace(target, tampered, 1)
        with self.assertRaises(ValueError):
            validate(self.report, altered_matrix)

    def test_ac21_ac22_ac23_contrato_real(self):
        """Pruebas existentes invocan Node y código JS real con fixtures."""
        methods = tuple(
            "tests.test_factory_control_local_commands."
            "FactoryControlLocalCommandsTests." + case
            for case in (
                "test_ac21_hung_tab_has_bounded_ack_wait",
                "test_ac22_host_grant_revocation_blocks_ack",
                "test_ac23_hung_tab_discovery_fails_closed",
            )
        )
        suite = unittest.defaultTestLoader.loadTestsFromNames(methods)
        result = unittest.TestResult()
        suite.run(result)
        self.assertEqual(3, result.testsRun)
        self.assertFalse(result.failures, str(result.failures))
        self.assertFalse(result.errors, str(result.errors))

    def test_regresiones_reales_existentes(self):
        """Reutiliza mocks/testigos ya fusionados, sin I/O productivo."""
        suite = unittest.defaultTestLoader.loadTestsFromNames(REAL_SUITES)
        result = unittest.TestResult()
        suite.run(result)
        self.assertGreaterEqual(result.testsRun, 30)
        self.assertFalse(result.failures, str(result.failures))
        self.assertFalse(result.errors, str(result.errors))

    def test_frontera_privacidad_y_live(self):
        self.assertEqual("NO_VERIFICABLE", parse_rows(
            self.report, report=True)["AF1-AC-05"][4])
        self.assertIn("puente sigue **OFF**", self.report)
        self.assertIn("Sin gastos ni servicios externos", self.report)
        self.assertIn("38/38 filas", self.report)
        self.assertNotIn("| CUBIERTO |", self.report)
        # Esta propia prueba no crea acceso de red, sesión, ni escribe datos.
        tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
        blocked = {"requests", "urllib", "httpx", "socket", "selenium", "playwright"}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                self.assertFalse({a.name.split(".")[0] for a in node.names}
                                 & blocked)
            elif isinstance(node, ast.ImportFrom) and node.module:
                self.assertNotIn(node.module.split(".")[0], blocked)


if __name__ == "__main__":
    unittest.main()
