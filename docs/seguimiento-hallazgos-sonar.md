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

## Segunda intervención: Reliability C residual en main (22-nov-2026)

- Después de [PR #485](https://github.com/pl0n3r/AutoFactory/pull/485), `main@a34e8864413cb38cde739d775cf9b9e8e89ed6a9` conserva `new_reliability_rating=3` (C), objetivo 1 (A); `new_security_rating=1` (A).
- [Diagnóstico Sonar autenticado read-only, job 137122778660](https://github.com/pl0n3r/AutoFactory/actions/runs/44845234798/job/137122778660): 394 issues OPEN/New Code en el período vigente y exactamente **seis impactos RELIABILITY:MEDIUM**. Los hallazgos anteriores S2871 HIGH están resueltos; no se infiere estado final A/A sin nuevo check exact-main.
- `javascript:S8786`: `AaEjC-ZL7PojUimwOX0c`, `AaEjC-ZL7PojUimwOX0d` en `autopilot-core.js:396-397`; `AaEjC-Kd7PojUimwOX0Y`, `AaEjC-Kd7PojUimwOX0Z` en espejo Safari. Causa: regex con repeticiones de espacios y delimitadores ambiguos que permiten backtracking superlineal. Reparación: reconocimiento de tokens en un paso, priorizando GPT-5.6 Sol, manteniendo la compatibilidad de guiones y espacios.
- `javascript:S9383`: `AaDv-3FnbODfAelYAbdi` en `popup.js:243` y `AaDv-2wdbODfAelYAbdS` en espejo Safari. Causa: migración de valores predeterminados mediante escritura asíncrona sin handler de rechazo. Reparación: `catch` opcional en APIs que devuelven Promise, manteniendo compatibilidad con implementaciones callback-only y señal visible de error.
- Prueba de aceptación: `tests/test_hallazgos_sonar_resueltos.py::HallazgosSonarResueltosTests::test_criterio_principal` verifica regresiones S2871, paridad byte a byte Safari/Chrome, reconocimiento de modelos y handler de error. El `SonarCloud Code Analysis` del PR solo acredita su delta; **AC-03 se cierra únicamente si Security/ Reliability A/A en main exacto**.
