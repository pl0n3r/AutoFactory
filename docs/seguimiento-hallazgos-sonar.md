# AutoFactory — seguimiento de hallazgos SonarCloud

## Fuente y ventana comprobadas

- Diagnóstico de solo lectura autenticado: [AutoFactory #219 / job 137091748928](https://github.com/pl0n3r/AutoFactory/actions/runs/44845234798/job/137091748928); 404 hallazgos OPEN/New Code en `main@9a5ea3142ccdb7e311c577d13883796d7c08aa6a`. La cantidad es una instantánea, no garantía de que todos sean de seguridad o fiabilidad.
- `new_code_periods/show` y `new_code_periods/list` respondieron HTTP 404 en la instancia; `components/show` acreditó `leakPeriodDate=2026-09-25T09:36:46+0000` y `analysisDate=2026-11-17T02:26:34+0000`. No inventar el tipo de período no obtenido.
- Quality Gate de `main` a esa fecha: `new_security_rating=2` (B), `new_reliability_rating=4` (D). Umbral exigido: ambos A (1). No relajar umbrales, excluir rutas ni suprimir reglas.

## BUGs Reliability HIGH abordados en #428

| Sonar issueKey | Regla | Archivo y línea de inventario | Impacto | Corrección con regresión |
| --- | --- | --- | --- | --- |
| `AaFLIMxhbbm1AbGOhcwR` | `javascript:S2871` | `test-factory-control-local-chats.cjs:35` | RELIABILITY HIGH | Ordenar nombres de campo con `localeCompare` |
| `AaEw7JuHpE17E8LTJvQo` | `javascript:S2871` | `test-factory-control-executor.cjs:220` | RELIABILITY HIGH | Ordenar códigos con `localeCompare` |
| `AaEw7KRjpE17E8LTJvQs` | `javascript:S2871` | `test-factory-control-ledger.cjs:552` | RELIABILITY HIGH | Ordenar códigos con `localeCompare` |

Prueba: `tests/test_hallazgos_sonar_resueltos.py::HallazgosSonarResueltosTests::test_criterio_principal`. Las suites Node existentes ejercitan los contratos de test originales. El cierre depende de los checks terminales exact-HEAD y del nuevo análisis SonarCloud, no solo de esta tabla.

## Resto fuera de estos claims

- `AaEw6y3m1qRQXrU8TCHG` — `javascript:S4036`, `test-factory-control-pairing.cjs:972`, SECURITY LOW: se corrige en el PR padre [#481](https://github.com/pl0n3r/AutoFactory/pull/481), sin editar esa ruta en #428.
- Hallazgos menores de Reliability/Maintainability, incluidos `javascript:S8786` en `autopilot-core.js` y su espejo Safari, no se declaran corregidos. Cualquier cambio en el espejo exige claims separados y mantener paridad.
- El Quality Gate del PR aislado no acredita automáticamente Security/ Reliability A/A de `main`. Las dos ramas se concilian mediante PRs protegidos y nuevo análisis exact-main antes de declarar resuelto #219 o habilitar release.
