# Verificación 01 de 04 — AutoFactory #450

Corte fuente: `main@d0a1297ff5022746c92eb480747bd48e1016a41c`, 5-nov-2026. Alcance: exactamente 40 filas de `README.md` (README-01-01 a README-09-04) tal como fueron asignadas por [#450](https://github.com/pl0n3r/AutoFactory/issues/450); fuente de contraste `docs/matriz-cobertura.md` **solo lectura**. Esta hoja es una verificación *offline*, no certificado de instalación ni actualización de la matriz. Ninguna fila se promueve a `CUBIERTO` por estas evidencias.

Criterio: `A_PARCIAL` = subcontrato de código/fixture reproducible, no producto instalado; `B_EXTERNA` = observación real de GitHub, navegador, release o rollback pendiente; `C_DECLARATIVA` = política o fuente de verdad, sin ejecución propia. Los tres conservan estado integral `NO_VERIFICABLE`; estado operativo `UNKNOWN`. Donde existe trabajo de cobertura, se preserva en hojas ya abiertas, sin duplicarlas.

| Fila | Veredicto limitado | Archivo que respalda la afirmación | Aserción exacta buscada en ese archivo | Seguimiento existente |
| --- | --- | --- | --- | --- |
| README-01-01 | B_EXTERNA | `.github/workflows/validate.yml` | `name: Validate / Pruebas y smoke Chrome` | #220 |
| README-01-02 | B_EXTERNA | `CHANGELOG.md` | `## 1.7.38` | #219 |
| README-01-03 | C_DECLARATIVA | `AGENTES.md` | `ControlBot` | #1 |
| README-01-04 | C_DECLARATIVA | `factory-control-activation.js` | `legal_blocked` | #134 |
| README-01-05 | B_EXTERNA | `AGENTES.md` | `smoke de instalación/carga` | #122 |
| README-02-01 | B_EXTERNA | `CHANGELOG.md` | `## 1.7.38` | #122 |
| README-02-02 | C_DECLARATIVA | `CHANGELOG.md` | `## 1.7.38` | #219 |
| README-02-03 | C_DECLARATIVA | `decisiones.yml` | `D-061` | #134 |
| README-03-01 | B_EXTERNA | `.github/workflows/coordinacion.yml` | `issues:` | #219 |
| README-03-02 | B_EXTERNA | `.github/workflows/coordinacion.yml` | `pull_request:` | #219 |
| README-03-03 | B_EXTERNA | `AGENTES.md` | `trabajo/issue-N` | #228 |
| README-03-04 | B_EXTERNA | `decisiones.yml` | `D-061` | #134 |
| README-03-05 | B_EXTERNA | `.github/workflows/validate.yml` | `name: Validate / Pruebas y smoke Chrome` | #219 |
| README-04-01 | A_PARCIAL | `autopilot-core.js` | `COMPOSER_SELECTORS` | #122 |
| README-04-02 | A_PARCIAL | `content.js` | `adaptiveRecovery` | #122 |
| README-04-03 | A_PARCIAL | `factory-control-activation.js` | `legal_blocked` | #134 |
| README-05-01 | C_DECLARATIVA | `AGENTES.md` | `Factory v1` | #1 |
| README-05-02 | A_PARCIAL | `manifest.json` | `"manifest_version": 3` | #122 |
| README-05-03 | C_DECLARATIVA | `decisiones.yml` | `D-061` | #134 |
| README-06-01 | A_PARCIAL | `manifest.json` | `"background": {` | #122 |
| README-06-02 | A_PARCIAL | `package.json` | `"pretest":` | #220 |
| README-06-03 | C_DECLARATIVA | `AGENTES.md` | `no servidor web` | #1 |
| README-06-04 | A_PARCIAL | `manifest.json` | `"optional_host_permissions"` | #134 |
| README-06-05 | A_PARCIAL | `scripts/verify-release-evidence.cjs` | `safari_smoke` | #122 |
| README-07-01 | B_EXTERNA | `AGENTES.md` | `trabajo/issue-N` | #219 |
| README-07-02 | C_DECLARATIVA | `AGENTES.md` | `sin inventar UUID` | #219 |
| README-07-03 | C_DECLARATIVA | `.github/workflows/coordinacion.yml` | `pl0n3r/factory/.github/workflows/coordinacion.yml@v1` | #219 |
| README-07-04 | A_PARCIAL | `scripts/verify-release-evidence.cjs` | `chrome_smoke` | #122 |
| README-07-05 | A_PARCIAL | `scripts/verify-release-evidence.cjs` | `rollback` | #122 |
| README-08-01 | A_PARCIAL | `AGENTES.md` | `tokens` | #219 |
| README-08-02 | A_PARCIAL | `factory-control-authorization.js` | `Command not authorized` | #134 |
| README-08-03 | A_PARCIAL | `account-budget.js` | `budgetCapacityAt` | #219 |
| README-08-04 | C_DECLARATIVA | `AGENTES.md` | `datos.yml` | #1 |
| README-08-05 | B_EXTERNA | `scripts/verify-release-evidence.cjs` | `rollback` | #122 |
| README-08-06 | A_PARCIAL | `scripts/verify-extension-assets.cjs` | `validateExtensionTree` | #122 |
| README-08-07 | A_PARCIAL | `factory-control-local-publisher.js` | `optedIn` | #134 |
| README-09-01 | C_DECLARATIVA | `README.md` | `#134` | #1 |
| README-09-02 | C_DECLARATIVA | `AGENTES.md` | `PR existente` | #219 |
| README-09-03 | C_DECLARATIVA | `decisiones.yml` | `D-062` | #1 |
| README-09-04 | B_EXTERNA | `CHANGELOG.md` | `## 1.7.38` | #219 |

## Alcance y brechas por categoría

- **A_PARCIAL (15):** la prueba `tests/test_verificacion_autofactory_01.py` comprueba cada texto exacto, la referencia real y la consistencia de este informe; reutiliza los contratos genuinos de `test-core.cjs`, `test-extension-integrity.cjs` y `tests/test_cobertura_autofactory_07.py` para denegaciones, paridad, presupuesto y release. Estos contratos usan fixtures; falta evidencia de instalación y tráfico real según las hojas indicadas.
- **B_EXTERNA (12):** requieren recibos independientes exact-SHA y estado contemporáneo GitHub, instalación/ejecución Safari #122, identidad de release y rollback real. `Validate` sobre el PR **no** reemplaza esas pruebas. La última release pública vista en la lectura inicial era `v1.7.38`, pero esa comprobación por sí sola no acredita instalación ni rollback.
- **C_DECLARATIVA (13):** las fuentes definen límites y responsabilidades, no verificaciones de runtime. D-060, D-061 y D-062 se preservan. No iniciar pairing, tráfico o tratamientos reales sin autorización legal ni contabilizar vínculos de Issues como trabajo terminado.

## Verificación y resultado

- Reproducir solo en un checkout de fuentes: `python3 -m unittest -v tests.test_verificacion_autofactory_01` con Node.js ≥20 disponible; `npm test` y `Validate / Pruebas y smoke Chrome` son gates separados y no equivalen a instalación.
- Pruebas negativas: quitar/cambiar una afirmación del README, borrar/duplicar fila, sustituir un archivo o una aserción, promover `CUBIERTO` o fabricar evidencia operativa hace fallar este contrato.
- Ningún cambio en `docs/matriz-cobertura.md`, release, permisos, secretos, backend, estado de GitHub o ambiente real. La hoja consolidadora de #219 es la única que reclasifica la matriz tras evidencias verificadas.
