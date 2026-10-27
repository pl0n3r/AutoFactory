# Partición ejecutable del puente AutoFactory ↔ ControlBot (#281)

**Corte de inventario:** 27-oct-2026, `AutoFactory/main@d4fecf01c51acbf78bb6f3ef27557ebf38a4c6f5`. Inventario de Issues y PRs verificado en GitHub. Este documento planifica **solo ejecución offline sintética**. Los roadmaps #129–#134 y el épico #1 permanecen **OPEN**; ningún corte parcial los cierra.

**Límite de autoridad:** `D-061` y `ControlBot#20` exigen consentimiento autenticado, privacidad, mínimo privilegio, seguridad y una decisión habilitante antes de pairing, latidos, órdenes, señales de cuenta, tráfico, E2E real o go-live. **NO_ACTIVAR_BRIDGE**. La puerta legal y #89 no se satisfacen por pruebas ni por fusión de un PR. No registrar texto de chats, tokens, cookies, rutas identificables ni contraseñas.

## Roadmaps y hojas canónicas

| Roadmap | Hoja | Estado | Dependencia | Issue |
| --- | --- | --- | --- | --- |
| #129 | Replay de pairing revocado/reinicio, simulación pura | DISPONIBLE_OFFLINE | Contratos de pairing/storage ya fusionados; sin red | [#282](https://github.com/pl0n3r/AutoFactory/issues/282) |
| #129 | Pairing real visible y revocable | BLOQUEADO_REAL | D-061, ControlBot#20, #89, identidad y consentimiento | [#129](https://github.com/pl0n3r/AutoFactory/issues/129) |
| #130 | Heartbeat con reloj inyectado, stale y reconexión | DISPONIBLE_OFFLINE | Coordinador heartbeat ya fusionado; sin alarmas reales | [#283](https://github.com/pl0n3r/AutoFactory/issues/283) |
| #130 | Heartbeat real de 60 s y estado offline | BLOQUEADO_REAL | D-061, ControlBot#20, #129, identidad y red autorizadas | [#130](https://github.com/pl0n3r/AutoFactory/issues/130) |
| #131 | ACK perdido, replay de orden y efecto ficticio único | DISPONIBLE_OFFLINE | Ledger/ejecutor ya fusionados; sin enviar chats | [#284](https://github.com/pl0n3r/AutoFactory/issues/284) |
| #131 | Envío real verificado con outcome | BLOQUEADO_REAL | D-061, ControlBot#20, #129, sesión/pestaña autorizada | [#131](https://github.com/pl0n3r/AutoFactory/issues/131) |
| #132 | Freshness y precedencia de límite/login simulados | DISPONIBLE_OFFLINE | Parser account-state ya fusionado; reloj ficticio | [#285](https://github.com/pl0n3r/AutoFactory/issues/285) |
| #132 | Límite de uso y sesión reales | BLOQUEADO_REAL | D-061, ControlBot#20, consentimiento y señales reales | [#132](https://github.com/pl0n3r/AutoFactory/issues/132) |
| #133 | E2E sintético con kill y rollback inyectados | DISPONIBLE_OFFLINE | #282, #283, #284, #285; datos ficticios | [#286](https://github.com/pl0n3r/AutoFactory/issues/286) |
| #133 | E2E gobernado con ControlBot real | BLOQUEADO_REAL | D-061, ControlBot#20, #129, #130, #131, #132, #89 | [#133](https://github.com/pl0n3r/AutoFactory/issues/133) |
| #134 | Preview documental NO-GO y recibo de evidencia | DISPONIBLE_OFFLINE | #286; sin decisión automática ni activación | [#287](https://github.com/pl0n3r/AutoFactory/issues/287) |
| #134 | Live readiness y activación sostenida | BLOQUEADO_REAL | D-061, ControlBot#20, #133, #219, #122, consentimiento, OWNER | [#134](https://github.com/pl0n3r/AutoFactory/issues/134) |

**Estado de las hojas:** #282–#287 se crearon en GitHub como issues abiertos con un único `factory-plan-task`, rutas exclusivas, pruebas y dependencias; `DISPONIBLE_OFFLINE` no significa implementado ni validado. #129–#133 continúan bloqueados y #134 planificado sin autorización de producción. El estado OPEN corresponde a la observación de este corte, no a una comprobación en tiempo real del test de Python.

## Trabajo ya fusionado: no repetir

| Evidencia auténtica | Entrega offline previa | No acredita |
| --- | --- | --- |
| [PR #215](https://github.com/pl0n3r/AutoFactory/pull/215) y [PR #245](https://github.com/pl0n3r/AutoFactory/pull/245) | Snapshot inmutable y protección TOCTOU del desafío de pairing | Pairing real |
| [PR #239](https://github.com/pl0n3r/AutoFactory/pull/239) | Paridad de estados offline Chrome/Safari | E2E real |
| [PR #254](https://github.com/pl0n3r/AutoFactory/pull/254) | Demo sintética de pairing en popup | Credencial/autorización real |
| [PR #247](https://github.com/pl0n3r/AutoFactory/pull/247) y [PR #251](https://github.com/pl0n3r/AutoFactory/pull/251) | Señal SIN_AVANCE y progreso local con datos minimizados | Telemetría remota |
| [PR #280](https://github.com/pl0n3r/AutoFactory/pull/280) | Compatibilidad de Validate con HEAD antiguo | Autorización de puente ni release |

En `main` ya existen módulos aislados `factory-control-pairing.js`, `factory-control-heartbeat.js`, `factory-control-executor.js`, `factory-control-account-state.js`, `factory-control-runtime.js` y `factory-control-readiness-report.js`, junto a tests `test-factory-control-*.cjs`. Las seis hojas nuevas **amplían escenarios específicos de simulación**, sin rehacer esas APIs ni reclamar sus archivos.

## Dependencias globales y puertas de detención

- **Autorización real:** D-061 + ControlBot#20 + #89; no abrir endpoints, emparejar usuarios, activar alarmas reales o automatizar login/MFA/captcha.
- **Seguridad:** #219 permanece incidente de Quality Gate principal sin evidencia granular acreditada en este corte; no inferir que se resolvió por SonarCloud verde de un PR.
- **Extensión y smoke:** #122 requiere Safari/Xcode reales; CI Chrome no demuestra instalación Safari ni producción.
- **Coordinación:** #216 aún exige evidencia de cierre parcial auténtico; las hojas offline NO deben cerrar automáticamente #129–#134.
- **Legal/readiness:** #133 solo puede ejecutar E2E real después de las cuatro capacidades autorizadas; #134 requiere revisión OWNER, pruebas reales y rollback antes de decidir live. Mantener estado **NO-GO**.
- **Reversión:** la partición #281 añade solo este documento y su prueba; eliminar ambos revierte la documentación sin alterar runtime, manifiestos ni permisos.

## Evidencia mínima y criterio de cierre de #281

El test `tests/test_particion_roadmaps_puente.py` valida las 12 filas del snapshot (una hoja offline más su gate real por roadmap), URLs reales de issues y PRs fusionados, dependencias correctas, ausencia de activación y clasificación fail-closed. `python3 -m unittest -v tests.test_particion_roadmaps_puente` valida la matriz **sin** red ni credenciales. Las pruebas de cada hoja #282–#287 se ejecutarán únicamente dentro de su propia V3/PR y no se consideran realizadas por la partición.

Cierre de #281 = issues canónicos materializados + matriz y prueba de partición + CI `Validate / Pruebas y smoke Chrome` y seguridad en SHA exacto. **NO** implica cerrar #129–#134 ni #1, ni hacer pairing, tráfico o go-live.
