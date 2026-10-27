# AutoFactory #291 — contraste offline de reglas, decisiones y hojas

**Corte del contraste:** `main@6dd3a264124059c4c0cae3ff4fdc417d1c58eeb6` · `phase=construccion` · reserva V3 `2054718e-bc2d-4cae-adbd-6a9f1c67e06f` · [Issue #291](https://github.com/pl0n3r/AutoFactory/issues/291).

**Alcance:** las **45** filas `NO_VERIFICABLE` originalmente existentes en `docs/matriz-cobertura.md` para `AGENTES-*`, `DEC-D-*` y `ISSUE-*`. Se conservan otras tres entradas ya clasificadas (`ISSUE-253`, `ISSUE-255`, `ISSUE-257`), sin reconfirmarlas artificialmente. Los nombres de ruta son evidencia de artefactos inspeccionables; **no acreditan por sí mismos que su comportamiento pase en runtime**.

**Regla de decisión:** `CUBIERTO` requiere código, prueba efectiva y PR ya fusionado; no hay aquí evidencia completa nueva para promover el grupo. `SIN_COBERTURA` exige una hoja real no cubierta por un issue anterior; todos estos renglones conservan issue fuente o dependencia identificada. La omisión de un smoke real, permiso, operador o evidencia terminal queda `NO_VERIFICABLE`, nunca `CUBIERTO` o `EN_CURSO` solo por archivos. `D-054`, `D-055` y `D-059` son decisiones globales activas: su alcance a BD/Hostinger no implica runtime de BD/Hostinger en esta extensión y no se descartan decisiones activas.

## Veredictos por fila

| ID | Fuente | Evidencia contrastada (artefacto + prueba existente) | Estado | Brecha verificable |
| --- | --- | --- | --- | --- |
| AGENTES-01-01 | [AGENTES.md](../AGENTES.md) | `manifest.json`; `tests/test_safari_project_bundle.py` | NO_VERIFICABLE | falta smoke de instalación Chrome y Safari real |
| AGENTES-01-02 | [AGENTES.md](../AGENTES.md) | `package.json`; `tests/test_safari_build_smoke.py` | NO_VERIFICABLE | falta ejecutar Xcode/Safari GUI real para el entorno objetivo (#122) |
| AGENTES-01-03 | [AGENTES.md](../AGENTES.md) | `manifest.json`; `tests/test_release_candidate_1_7_38.py` | NO_VERIFICABLE | paridad documental no acredita el artefacto realmente instalado |
| AGENTES-01-04 | [AGENTES.md](../AGENTES.md) | `.github/workflows/release.yml`; `tests/test_release_artifact_attestation.py` | NO_VERIFICABLE | la publicación requiere una decisión y un corte instalable comprobado |
| AGENTES-01-05 | [AGENTES.md](../AGENTES.md) | `CHANGELOG.md`; `tests/test_ci_salida_quality.py` | NO_VERIFICABLE | no hay enlace exact-SHA entre todo el estado operativo y una instalación real |
| AGENTES-01-06 | [AGENTES.md](../AGENTES.md) | `datos.yml`; `tests/test_factory_control_readiness_report.py` | NO_VERIFICABLE | fase declarada construccion no acredita operación live |
| AGENTES-01-07 | [AGENTES.md](../AGENTES.md) | `factory-control-runtime.js`; `tests/test_factory_control_runtime.py` | NO_VERIFICABLE | los contratos offline no prueban pairing autorizado y conectado |
| AGENTES-01-08 | [AGENTES.md](../AGENTES.md) | `.github/workflows/coordinacion.yml`; `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | la definición de etiquetas no demuestra clasificación de todos los Issues y PR |
| AGENTES-01-09 | [AGENTES.md](../AGENTES.md) | `.github/workflows/coordinacion.yml`; `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | falta auditoría exhaustiva de cardinalidad de etiquetas en Issues y PR |
| AGENTES-01-10 | [AGENTES.md](../AGENTES.md) | `.github/workflows/coordinacion.yml`; `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | el convenio de rama no certifica todas las ramas históricas |
| AGENTES-01-11 | [AGENTES.md](../AGENTES.md) | `.github/workflows/coordinacion.yml`; `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | el fallback manual no sustituye la reserva V3 del bot |
| AGENTES-01-12 | [AGENTES.md](../AGENTES.md) | `.github/workflows/validate.yml`; `tests/test_validate_required_check.py` | NO_VERIFICABLE | npm test y CI no acreditan smoke real de instalación Safari |
| AGENTES-01-13 | [AGENTES.md](../AGENTES.md) | `docs/RELEASE-EVIDENCE.md`; `tests/test_release_artifact_attestation.py` | NO_VERIFICABLE | el gate offline no acredita extensión instalada y observada |
| AGENTES-01-14 | [AGENTES.md](../AGENTES.md) | `.github/workflows/release.yml`; `tests/test_release_artifact_attestation.py` | NO_VERIFICABLE | no se verificó restauración real de la versión instalable previa |
| AGENTES-01-15 | [AGENTES.md](../AGENTES.md) | `scripts/package-release.py`; `tests/test_release_packaged_assets.py` | NO_VERIFICABLE | no existe comprobación de procedencia de cada paquete histórico |
| AGENTES-01-16 | [AGENTES.md](../AGENTES.md) | `factory-control-protocol.js`; `tests/test_factory_control_pairing_public_result.py` | NO_VERIFICABLE | fixtures locales no demuestran privacidad de todo log en ejecución |
| AGENTES-01-17 | [AGENTES.md](../AGENTES.md) | `datos.yml`; `tests/test_factory_control_pairing_audit_contract.py` | NO_VERIFICABLE | no se verificó una actualización real de tratamiento con autoridad legal |
| AGENTES-01-18 | [AGENTES.md](../AGENTES.md) | `factory-control-pairing.js`; `tests/test_factory_control_pairing_public_result.py` | NO_VERIFICABLE | permanece sin aprobación legal ControlBot#20 ni pairing real |
| AGENTES-01-19 | [AGENTES.md](../AGENTES.md) | `factory-control-authorization.js`; `tests/test_factory_control_local_commands.py` | NO_VERIFICABLE | pruebas de denegación no acreditan comportamiento sobre sesión real |
| AGENTES-01-20 | [AGENTES.md](../AGENTES.md) | `docs/RELEASE-EVIDENCE.md`; `tests/test_ci_salida_quality.py` | NO_VERIFICABLE | falta verificación de extensión instalada y no existe health web aplicable |
| AGENTES-01-21 | [AGENTES.md](../AGENTES.md) | `local-tab-progress.js`; `tests/test_local_tab_progress.py` | NO_VERIFICABLE | observación sintética no acredita inspección humana de pestaña real |
| AGENTES-01-22 | [AGENTES.md](../AGENTES.md) | `local-tab-progress.js`; `tests/test_local_tab_progress.py` | NO_VERIFICABLE | límite del log de una ruta no demuestra saneamiento de todas las superficies |
| AGENTES-02-01 | [AGENTES.md](../AGENTES.md) | `popup.js`; `tests/test_safari_project_bundle.py` | NO_VERIFICABLE | paridad local no prueba ausencia de colisiones entre PR concurrentes |
| AGENTES-02-02 | [AGENTES.md](../AGENTES.md) | `decisiones.yml`; `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | no se auditaron diez commits y tres rondas para cada PR histórico |
| AGENTES-02-03 | [AGENTES.md](../AGENTES.md) | `docs/OBSERVADOR-RESERVAS-V3.md`; `tests/test_observador_reservas_consumidor.py` | NO_VERIFICABLE | el observador offline no acredita integración real del runtime |
| ISSUE-258 | [Issue #258](https://github.com/pl0n3r/AutoFactory/issues/258) | `docs/lista-salida-produccion.md`; `tests/test_lista_salida_produccion.py` | NO_VERIFICABLE | lista entregada; las puertas humanas del lanzamiento siguen sin pruebas |
| ISSUE-1 | [Issue #1](https://github.com/pl0n3r/AutoFactory/issues/1) | `docs/factory-control-protocol.md`; `tests/test_factory_control_runtime.py` | NO_VERIFICABLE | épico ControlBot sigue bloqueado por aprobación legal y ejecución real |
| ISSUE-122 | [Issue #122](https://github.com/pl0n3r/AutoFactory/issues/122) | `safari/ChatGPT Autopilot Local Extension/Info.plist`; `tests/test_safari_build_smoke.py` | NO_VERIFICABLE | smoke Safari/Xcode real pendiente según #122 |
| ISSUE-129 | [Issue #129](https://github.com/pl0n3r/AutoFactory/issues/129) | `factory-control-pairing.js`; `tests/test_factory_control_pairing_public_result.py` | NO_VERIFICABLE | falta consentimiento y aprobación ControlBot#20 para pairing real |
| ISSUE-130 | [Issue #130](https://github.com/pl0n3r/AutoFactory/issues/130) | `factory-control-heartbeat.js`; `tests/test_factory_control_heartbeat_presence.py` | NO_VERIFICABLE | no hay heartbeat autenticado real hacia ControlBot |
| ISSUE-131 | [Issue #131](https://github.com/pl0n3r/AutoFactory/issues/131) | `factory-control-executor.js`; `tests/test_factory_control_executor_audit.py` | NO_VERIFICABLE | no hay envío real de usuario autorizado ni ACK externo |
| ISSUE-132 | [Issue #132](https://github.com/pl0n3r/AutoFactory/issues/132) | `factory-control-account-state.js`; `tests/test_factory_control_account_state.py` | NO_VERIFICABLE | faltan señales observadas de sesión real sin invadir login |
| ISSUE-133 | [Issue #133](https://github.com/pl0n3r/AutoFactory/issues/133) | `factory-control-runtime.js`; `tests/test_factory_control_runtime.py` | NO_VERIFICABLE | falta E2E vivo autorizado de pairing a outcome |
| ISSUE-134 | [Issue #134](https://github.com/pl0n3r/AutoFactory/issues/134) | `docs/lista-salida-produccion.md`; `tests/test_lista_salida_produccion.py` | NO_VERIFICABLE | go-live depende de requisitos reales y decisión del dueño |
| ISSUE-216 | [Issue #216](https://github.com/pl0n3r/AutoFactory/issues/216) | `.github/workflows/coordinacion.yml`; `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | no se acreditó cierre roadmap_partial correcto de #129 |
| ISSUE-219 | [Issue #219](https://github.com/pl0n3r/AutoFactory/issues/219) | `.github/workflows/sonar-check-details.yml`; `tests/test_sonar_relay_sanitization.py` | NO_VERIFICABLE | incidente SonarCloud exact-main pendiente de evidencia de remediación |
| DEC-D-054 | [decisiones.yml](../decisiones.yml) | `decisiones.yml`; `tests/test_release_artifact_attestation.py` | NO_VERIFICABLE | migración de base de datos no aplica al runtime local; no hay backup de BD por acreditar |
| DEC-D-055 | [decisiones.yml](../decisiones.yml) | `decisiones.yml`; `tests/test_ci_salida_quality.py` | NO_VERIFICABLE | permiso general de construcción no habilita producción real de este puente |
| DEC-D-056 | [decisiones.yml](../decisiones.yml) | `.github/workflows/release.yml`; `tests/test_release_artifact_attestation.py` | NO_VERIFICABLE | falta smoke real Chrome/Safari y rollback de instalable |
| DEC-D-057 | [decisiones.yml](../decisiones.yml) | `.github/workflows/coordinacion.yml`; `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | no se auditó en vivo cardinalidad de etiquetas de todos los Issues y PR |
| DEC-D-058 | [decisiones.yml](../decisiones.yml) | `.github/workflows/coordinacion.yml`; `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | no se acreditó ejecución profesional de cada rol histórico |
| DEC-D-059 | [decisiones.yml](../decisiones.yml) | `decisiones.yml`; `tests/test_ci_salida_quality.py` | NO_VERIFICABLE | Hostinger es ajeno a la extensión y la decisión no autoriza escrituras |
| DEC-D-060 | [decisiones.yml](../decisiones.yml) | `docs/RELEASE-EVIDENCE.md`; `tests/test_release_artifact_attestation.py` | NO_VERIFICABLE | CI verde no acredita instalación ni reversión reales |
| DEC-D-061 | [decisiones.yml](../decisiones.yml) | `factory-control-pairing.js`; `tests/test_factory_control_pairing_public_result.py` | NO_VERIFICABLE | bridge OFF hasta consentimiento y puerta legal ControlBot#20 |
| DEC-D-062 | [decisiones.yml](../decisiones.yml) | `safari/ChatGPT Autopilot Local Extension/Resources/manifest.json`; `tests/test_safari_project_bundle.py` | NO_VERIFICABLE | paridad y privacidad offline no acreditan todos los artefactos instalados |

## Límites y continuación

La evidencia es **offline**. Las rutas y pruebas citadas están en el árbol de `main@6dd3a264124059c4c0cae3ff4fdc417d1c58eeb6`, pero esa existencia no equivale a una ejecución satisfactoria de cada AC, instalación GUI de Safari, observación real de SonarCloud ni aprobación legal. Los casos reales de `#122`, `#129`–`#134`, `#216` y `#219` siguen gobernados por sus Issues; no se abren duplicados ni se convierte un épico en hoja ejecutable. [ControlBot#20](https://github.com/pl0n3r/ControlBot/issues/20) y D-061 conservan el bridge **OFF**.

**Resultado:** 45 `NO_VERIFICABLE` con causa particularizada, 0 promociones a `CUBIERTO`, 0 `SIN_COBERTURA` sin hoja y 0 nuevos Issues. Las tres entradas ya clasificadas permanecen como estaban. El documento y su prueba pueden fusionarse sin activar pairing, red, producción, Xcode ni distribución de extensiones.
