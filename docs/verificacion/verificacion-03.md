# AutoFactory #452 — verificación lote 03/04

**Corte:** AutoFactory `main@d0a1297ff5022746c92eb480747bd48e1016a41c` · hoja #452 · reserva V3 `d7922e4b-6d0d-46c2-9dc1-ab194e3b081e` · fase `construccion`.

**Resultado:** 40/40 filas contrastadas, 12 AGENTES y 28 PROTO. Las 40 permanecen **NO_VERIFICABLE**: hay evidencia y regresiones locales, pero no prueba suficiente de instalación Chrome/Safari, operación autenticada, permiso legal o cobertura de toda la flota. Ninguna fila es SIN_COBERTURA en este lote; no se inventan hojas hijas. Esta hoja no modifica la matriz canónica ni declara production GREEN.

**Reproducción:** `python3 -m unittest -v tests.test_verificacion_autofactory_03` verifica cada fila contra matriz, normas, contraste #290/#291, artefactos y suites existentes, y ejecuta aserciones sintéticas del módulo Node real. Su resultado es **LOCAL_ONLY**, nunca autorización de conexión ControlBot ni humo Safari/Xcode. El PR de #452 acredita únicamente este inventario cuando GitHub confirme la fusión.

## Veredictos por fila

| ID | Norma | Código o workflow | Prueba de regresión local | Estado | Límite pendiente de evidencia auténtica |
| --- | --- | --- | --- | --- | --- |
| AGENTES-01-09 | `AGENTES.md` | `.github/workflows/coordinacion.yml` | `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | falta auditoría exhaustiva de cardinalidad de etiquetas en Issues y PR |
| AGENTES-01-10 | `AGENTES.md` | `.github/workflows/coordinacion.yml` | `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | el convenio de rama no certifica todas las ramas históricas |
| AGENTES-01-11 | `AGENTES.md` | `.github/workflows/coordinacion.yml` | `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | el fallback manual no sustituye la reserva V3 del bot |
| AGENTES-01-12 | `AGENTES.md` | `.github/workflows/validate.yml` | `tests/test_validate_required_check.py` | NO_VERIFICABLE | npm test y CI no acreditan smoke real de instalación Safari |
| AGENTES-01-13 | `AGENTES.md` | `docs/RELEASE-EVIDENCE.md` | `tests/test_release_artifact_attestation.py` | NO_VERIFICABLE | el gate offline no acredita extensión instalada y observada |
| AGENTES-01-14 | `AGENTES.md` | `.github/workflows/release.yml` | `tests/test_release_artifact_attestation.py` | NO_VERIFICABLE | no se verificó restauración real de la versión instalable previa |
| AGENTES-01-17 | `AGENTES.md` | `datos.yml` | `tests/test_factory_control_pairing_audit_contract.py` | NO_VERIFICABLE | no se verificó una actualización real de tratamiento con autoridad legal |
| AGENTES-01-20 | `AGENTES.md` | `docs/RELEASE-EVIDENCE.md` | `tests/test_ci_salida_quality.py` | NO_VERIFICABLE | falta verificación de extensión instalada y no existe health web aplicable |
| AGENTES-01-22 | `AGENTES.md` | `local-tab-progress.js` | `tests/test_local_tab_progress.py` | NO_VERIFICABLE | límite del log de una ruta no demuestra saneamiento de todas las superficies |
| AGENTES-02-01 | `AGENTES.md` | `popup.js` | `tests/test_safari_project_bundle.py` | NO_VERIFICABLE | paridad local no prueba ausencia de colisiones entre PR concurrentes |
| AGENTES-02-02 | `AGENTES.md` | `decisiones.yml` | `tests/test_coordination_workflow_contract.py` | NO_VERIFICABLE | no se auditaron diez commits y tres rondas para cada PR histórico |
| AGENTES-02-03 | `AGENTES.md` | `docs/OBSERVADOR-RESERVAS-V3.md` | `tests/test_observador_reservas_consumidor.py` | NO_VERIFICABLE | el observador offline no acredita integración real del runtime |
| PROTO-01 | `docs/factory-control-protocol.md` | `factory-control-protocol.js` | `tests/test_factory_control_v2.py` | NO_VERIFICABLE | Falta demostrar el intercambio real autenticado con el servicio ControlBot, la decisión de arquitectura no es activación. |
| PROTO-02 | `docs/factory-control-protocol.md` | `factory-control-protocol.js` | `tests/test_factory_control_v2.py` | NO_VERIFICABLE | Falta certificar transporte, permisos y observación de la composición fuera de los validadores puros. |
| PROTO-03 | `docs/factory-control-protocol.md` | `factory-control-authorization.js` | `tests/test_factory_control_v2.py` | NO_VERIFICABLE | No se acreditó consentimiento y autoridad del cliente real en cada comando externo. |
| PROTO-04 | `docs/factory-control-protocol.md` | `factory-control-protocol.js` | `tests/test_factory_control_v2.py` | NO_VERIFICABLE | Faltan comprobaciones operativas de reversión y una instalación observada con SHA coincidente. |
| PROTO-05 | `docs/factory-control-protocol.md` | `factory-control-ledger.js` | `tests/test_factory_control_v2_ledger_persistence.py` | NO_VERIFICABLE | No se acreditó durable ledger real en todas las interrupciones del service worker. |
| PROTO-06 | `docs/factory-control-protocol.md` | `factory-control-chrome-storage.js` | `tests/test_factory_control_v2_ledger_persistence.py` | NO_VERIFICABLE | Falta comprobar persistencia y recuperación en una extensión instalada, no solo mocks. |
| PROTO-07 | `docs/factory-control-protocol.md` | `factory-control-authorization.js` | `tests/test_factory_control_v2.py` | NO_VERIFICABLE | Falta autorización vinculante en un runtime conectado con identidad verificable. |
| PROTO-08 | `docs/factory-control-protocol.md` | `factory-control-heartbeat.js` | `tests/test_factory_control_heartbeat_presence.py` | NO_VERIFICABLE | No existe evidencia de latido real enviado y confirmado por ControlBot en sesión autenticada. |
| PROTO-09 | `docs/factory-control-protocol.md` | `factory-control-executor.js` | `tests/test_factory_control_executor_audit.py` | NO_VERIFICABLE | Faltan órdenes remotas autorizadas y ACK observados sin saltar la puerta legal. |
| PROTO-10 | `docs/factory-control-protocol.md` | `factory-control-pairing.js` | `tests/test_factory_control_pairing_public_result.py` | NO_VERIFICABLE | Falta consentimiento autenticado y aprobación ControlBot#20 para emparejamiento real. |
| PROTO-11 | `docs/factory-control-protocol.md` | `factory-control-transport.js` | `tests/test_factory_control_v2.py` | NO_VERIFICABLE | No se certificó conectividad HTTPS real, autenticada y con rechazo de red. |
| PROTO-12 | `docs/factory-control-protocol.md` | `factory-control-account-state.js` | `tests/test_factory_control_account_state.py` | NO_VERIFICABLE | Faltan estados reales de sesión observados sin inspeccionar datos privados. |
| PROTO-13 | `docs/factory-control-protocol.md` | `factory-control-response-consent.js` | `tests/test_factory_control_v2.py` | NO_VERIFICABLE | No se acreditó consentimiento de salida real ni transporte autorizado de respuesta. |
| PROTO-14 | `docs/factory-control-protocol.md` | `factory-control-pairing.js` | `tests/test_factory_control_pairing_audit_contract.py` | NO_VERIFICABLE | Falta acreditar almacenamiento y revocación de credencial en un pairing real autorizado. |
| PROTO-15 | `docs/factory-control-protocol.md` | `factory-control-pairing.js` | `tests/test_factory_control_pairing_audit_contract.py` | NO_VERIFICABLE | No se verificó emparejamiento persistido por perfil sobre dispositivo instalado. |
| PROTO-16 | `docs/factory-control-protocol.md` | `factory-control-instance-transport.js` | `tests/test_factory_control_instance_runtime.py` | NO_VERIFICABLE | Faltan sesiones HTTPS autenticadas con revocación y claves reales autorizadas. |
| PROTO-17 | `docs/factory-control-protocol.md` | `factory-control-instance-transport.js` | `tests/test_factory_control_instance_runtime.py` | NO_VERIFICABLE | No hay evidencia de cliente real conectado ni validación de un backend ControlBot. |
| PROTO-18 | `docs/factory-control-protocol.md` | `factory-control-runtime.js` | `tests/test_factory_control_runtime.py` | NO_VERIFICABLE | Falta integrar y observar pump de órdenes en extensión instalada con límites efectivos. |
| PROTO-19 | `docs/factory-control-protocol.md` | `factory-control-account-state.js` | `tests/test_factory_control_account_state.py` | NO_VERIFICABLE | No se acreditó señal real de cuenta desde navegador con consentimiento. |
| PROTO-20 | `docs/factory-control-protocol.md` | `factory-control-activation.js` | `tests/test_factory_control_readiness_report.py` | NO_VERIFICABLE | Falta puerta legal, consentimiento y verificación de readiness antes de activar el puente. |
| PROTO-21 | `docs/factory-control-protocol.md` | `factory-control-heartbeat.js` | `tests/test_factory_control_heartbeat_presence.py` | NO_VERIFICABLE | No se verificó heartbeat remoto con identidad de cuenta autenticada. |
| PROTO-22 | `docs/factory-control-protocol.md` | `factory-control-account-state-freshness.js` | `tests/test_account_state_freshness_offline.py` | NO_VERIFICABLE | Falta observación real de caducidad y señales efímeras en navegador habilitado. |
| PROTO-23 | `docs/factory-control-protocol.md` | `factory-control-heartbeat.js` | `tests/test_factory_control_heartbeat_presence.py` | NO_VERIFICABLE | Falta composición observada con transporte real y sin filtración de sesión. |
| PROTO-24 | `docs/factory-control-protocol.md` | `factory-control-account-state.js` | `tests/test_factory_control_account_state.py` | NO_VERIFICABLE | No se verificó reader efímero frente a cambios de autenticación reales. |
| PROTO-25 | `docs/factory-control-protocol.md` | `factory-control-local-publisher.js` | `tests/test_factory_control_local_publisher.py` | NO_VERIFICABLE | La publicación local sintética no acredita entrega externa ni autoridad de red. |
| PROTO-26 | `docs/factory-control-protocol.md` | `factory-control-local-commands.js` | `tests/test_factory_control_local_commands.py` | NO_VERIFICABLE | Falta operación LAN permitida y auditada desde instalación controlada. |
| PROTO-27 | `docs/factory-control-protocol.md` | `factory-control-local-commands.js` | `tests/test_factory_control_local_commands.py` | NO_VERIFICABLE | No se demostró ausencia de fuga de contenido en todos los canales LAN reales. |
| PROTO-28 | `docs/factory-control-protocol.md` | `factory-control-local-commands.js` | `tests/test_factory_control_local_commands.py` | NO_VERIFICABLE | Falta observación de STOP en pestañas reales desconectadas o suspendidas. |

## Límites y continuación

- AGENTES-01-09/10/11/02-01/02-02: requieren evidencia contemporánea de todas las etiquetas, ramas, carreras y reservas en GitHub; los contratos locales no reconstruyen ese historial.
- AGENTES-01-12/13/14/20: requieren recibos de smoke e instalación Chrome/Safari, rollback de versión anterior y SHA del paquete; CI exacto no acredita por sí solo instalación real.
- AGENTES-01-17/22/02-03: requieren trazabilidad de los cambios legales y privacidad del log observado; una aserción local no acredita todos los canales del dispositivo.
- PROTO-01..28: los tests mencionados verifican módulos puros o mocks, no red autenticada, consentimiento, pairing operativo, transporte ControlBot o go-live. Las brechas particulares se conservan literalmente en la tabla.
- **No hay datos personales, secretos, dispositivos, releases, permisos adicionales, gasto, tráfico externo ni despliegues.** El cambio es reversible mediante squash revert de los dos archivos propios de #452. Consolidar `docs/matriz-cobertura.md` corresponde a otra hoja.
