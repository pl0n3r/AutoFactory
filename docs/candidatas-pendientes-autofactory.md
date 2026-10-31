# AutoFactory #435 — candidatas pendientes: auditoría offline trazable

**Base:** `main@c178abb65bfd0d5d401cefc165f3546b659ff2c2`, después del merge #432. Inventario fuente sin modificaciones: **189 IDs**, con **131 `SIN_CANDIDATA`**, 50 `CANDIDATA_LOCAL`, 8 `DESCARTADO`. Estados históricos: 158 NO_VERIFICABLE, 22 CUBIERTO, 8 DESCARTADO, 1 EN_CURSO.

**Suite:** `tests/test_candidatas_pendientes_autofactory.py::CandidatasPendientesAutofactoryTests::test_criterio_principal` con casos negativos independientes. Sin sesión, red, cuenta, tokens, instalador ni extensión desplegada.

## Categorías sin promoción ficticia

- **PARCIAL_OFFLINE (8):** se verifica una porción local mediante aserciones ejecutadas sobre módulos JS con datos sintéticos **o mediante inspección estática de un workflow YAML**. En particular, `DOC-OBSERVADOR-RESERVAS-V3-01` se verifica **solo por lectura estática de sus permisos, caller y configuración**, sin ejecutar el observador ni demostrar comportamiento real de GitHub Actions. Ninguna evidencia parcial equivale a cumplir todo el requisito o modifica el estado de la matriz.
- **PENDIENTE_OFFLINE (24):** puede existir predicado local, pero todavía no se acredita íntegramente; no se fabrican tests vacíos.
- **OPERATIVO_EXTERNO (53):** precisa pruebas terminales autenticadas externas, instalación Chrome/Safari, release, Sonar nativo, consentimiento o decisión del dueño.
- **NORMA_DOCUMENTAL (46):** enuncia reglas y responsabilidades; un grep de fuente no prueba su cumplimiento real.

## Comprobaciones concretas reproducibles

| IDs fuente SIN_CANDIDATA | Garantía de código que se prueba parcialmente | Prueba |
| --- | --- | --- |
| DOC-OBSERVADOR-RESERVAS-V3-01 | **Inspección estática únicamente**, sin ejecutar workflow: el YAML declara un único `uses: ...@v1`, scopes `read` y no cancelación; variantes sintéticas con `@main` o permisos `write` se rechazan en la prueba | `test_criterio_principal#observer-readonly` |
| DOC-OFFLINE-SESSION-STATE-DENIALS-02, README-13-06 | Contrato puro deniega reenganche ante sesión cerrada, pausa, reloj futuro y lectura ambigua | `test_criterio_principal#keepalive-denials` |
| README-08-03 | Presupuesto igual a 80 % del límite observado o límite desconocido bloquea el contrato | `test_criterio_principal#keepalive-budget` |
| README-08-07 | Preflight de activación deniega sin gate legal pese a pairing/consent sintéticos válidos, sin filtrar identidad | `test_criterio_principal#activation-gates` |
| README-13-01, README-13-02 | Memoria adaptativa limita muestras y descarta texto, ID y token extra sintéticos | `test_criterio_principal#learning-minimization` |
| README-13-04 | Tras cinco fallos reales del contrato se abre circuit breaker y se bloquea recarga | `test_criterio_principal#reliability-backoff` |

**Límite:** los predicados anteriores prueban únicamente las superficies nombradas. No se reetiqueta una fila como CUBIERTO porque una porción haya pasado. La suite comprueba 189 IDs históricos, 131 filas sin candidata, exactitud de grupos, pruebas y negativas contra falsos positivos.

## Inventario completo SIN_CANDIDATA (#435)

| ID | Grupo | Evidencia parcial |
| --- | --- | --- |
| `README-01-01` | OPERATIVO_EXTERNO | — |
| `README-01-02` | OPERATIVO_EXTERNO | — |
| `README-01-03` | OPERATIVO_EXTERNO | — |
| `README-01-04` | OPERATIVO_EXTERNO | — |
| `README-01-05` | OPERATIVO_EXTERNO | — |
| `README-02-02` | OPERATIVO_EXTERNO | — |
| `README-02-03` | OPERATIVO_EXTERNO | — |
| `README-03-01` | OPERATIVO_EXTERNO | — |
| `README-03-02` | OPERATIVO_EXTERNO | — |
| `README-03-03` | OPERATIVO_EXTERNO | — |
| `README-03-04` | OPERATIVO_EXTERNO | — |
| `README-03-05` | OPERATIVO_EXTERNO | — |
| `README-05-01` | NORMA_DOCUMENTAL | — |
| `README-05-02` | NORMA_DOCUMENTAL | — |
| `README-06-01` | NORMA_DOCUMENTAL | — |
| `README-06-03` | NORMA_DOCUMENTAL | — |
| `README-06-04` | NORMA_DOCUMENTAL | — |
| `README-06-05` | NORMA_DOCUMENTAL | — |
| `README-07-01` | OPERATIVO_EXTERNO | — |
| `README-07-02` | OPERATIVO_EXTERNO | — |
| `README-07-03` | OPERATIVO_EXTERNO | — |
| `README-07-04` | OPERATIVO_EXTERNO | — |
| `README-07-05` | OPERATIVO_EXTERNO | — |
| `README-08-01` | PENDIENTE_OFFLINE | — |
| `README-08-02` | PENDIENTE_OFFLINE | — |
| `README-08-03` | PARCIAL_OFFLINE | `test_criterio_principal#keepalive-budget` |
| `README-08-04` | PENDIENTE_OFFLINE | — |
| `README-08-05` | PENDIENTE_OFFLINE | — |
| `README-08-06` | PENDIENTE_OFFLINE | — |
| `README-08-07` | PARCIAL_OFFLINE | `test_criterio_principal#activation-gates` |
| `README-09-01` | OPERATIVO_EXTERNO | — |
| `README-09-02` | OPERATIVO_EXTERNO | — |
| `README-09-03` | OPERATIVO_EXTERNO | — |
| `README-09-04` | OPERATIVO_EXTERNO | — |
| `README-09-05` | OPERATIVO_EXTERNO | — |
| `README-10-01` | NORMA_DOCUMENTAL | — |
| `README-10-02` | OPERATIVO_EXTERNO | — |
| `README-10-03` | NORMA_DOCUMENTAL | — |
| `README-11-01` | NORMA_DOCUMENTAL | — |
| `README-11-02` | NORMA_DOCUMENTAL | — |
| `README-11-03` | NORMA_DOCUMENTAL | — |
| `README-11-04` | NORMA_DOCUMENTAL | — |
| `README-11-05` | NORMA_DOCUMENTAL | — |
| `README-12-01` | OPERATIVO_EXTERNO | — |
| `README-12-02` | OPERATIVO_EXTERNO | — |
| `README-12-03` | OPERATIVO_EXTERNO | — |
| `README-12-04` | OPERATIVO_EXTERNO | — |
| `README-12-05` | OPERATIVO_EXTERNO | — |
| `README-12-06` | OPERATIVO_EXTERNO | — |
| `README-12-07` | OPERATIVO_EXTERNO | — |
| `README-12-08` | OPERATIVO_EXTERNO | — |
| `README-12-09` | OPERATIVO_EXTERNO | — |
| `README-12-10` | OPERATIVO_EXTERNO | — |
| `README-13-01` | PARCIAL_OFFLINE | `test_criterio_principal#learning-minimization` |
| `README-13-02` | PARCIAL_OFFLINE | `test_criterio_principal#learning-minimization` |
| `README-13-03` | PENDIENTE_OFFLINE | — |
| `README-13-04` | PARCIAL_OFFLINE | `test_criterio_principal#reliability-backoff` |
| `README-13-05` | PENDIENTE_OFFLINE | — |
| `README-13-06` | PARCIAL_OFFLINE | `test_criterio_principal#keepalive-denials` |
| `README-14-02` | PENDIENTE_OFFLINE | — |
| `README-14-03` | PENDIENTE_OFFLINE | — |
| `README-14-04` | PENDIENTE_OFFLINE | — |
| `README-15-01` | PENDIENTE_OFFLINE | — |
| `README-15-02` | PENDIENTE_OFFLINE | — |
| `README-15-03` | PENDIENTE_OFFLINE | — |
| `README-15-04` | PENDIENTE_OFFLINE | — |
| `AGENTES-01-01` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-02` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-04` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-05` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-06` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-07` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-08` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-09` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-10` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-11` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-12` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-13` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-14` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-15` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-16` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-17` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-18` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-19` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-20` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-21` | NORMA_DOCUMENTAL | — |
| `AGENTES-01-22` | NORMA_DOCUMENTAL | — |
| `AGENTES-02-01` | NORMA_DOCUMENTAL | — |
| `AGENTES-02-02` | NORMA_DOCUMENTAL | — |
| `AGENTES-02-03` | NORMA_DOCUMENTAL | — |
| `DOC-OBSERVADOR-RESERVAS-V3-01` | PARCIAL_OFFLINE | `test_criterio_principal#observer-readonly` |
| `DOC-OBSERVADOR-RESERVAS-V3-02` | OPERATIVO_EXTERNO | — |
| `DOC-OBSERVADOR-RESERVAS-V3-03` | OPERATIVO_EXTERNO | — |
| `DOC-OFFLINE-SESSION-STATE-DENIALS-01` | PENDIENTE_OFFLINE | — |
| `DOC-OFFLINE-SESSION-STATE-DENIALS-02` | PARCIAL_OFFLINE | `test_criterio_principal#keepalive-denials` |
| `DOC-OFFLINE-SESSION-STATE-DENIALS-03` | PENDIENTE_OFFLINE | — |
| `DOC-OFFLINE-SESSION-STATE-DENIALS-04` | OPERATIVO_EXTERNO | — |
| `DOC-RELEASE-EVIDENCE-01` | OPERATIVO_EXTERNO | — |
| `DOC-RELEASE-EVIDENCE-02` | OPERATIVO_EXTERNO | — |
| `DOC-RELEASE-EVIDENCE-03` | OPERATIVO_EXTERNO | — |
| `DOC-CI-EXTENSION-SECURITY-01` | OPERATIVO_EXTERNO | — |
| `DOC-EXTENSION-SOURCE-PREFLIGHT-01` | PENDIENTE_OFFLINE | — |
| `DOC-RELEASE-SECURITY-01` | OPERATIVO_EXTERNO | — |
| `DOC-SESSION-KEEPALIVE-02` | OPERATIVO_EXTERNO | — |
| `DOC-SESSION-KEEPALIVE-03` | PENDIENTE_OFFLINE | — |
| `DOC-SESSION-KEEPALIVE-04` | PENDIENTE_OFFLINE | — |
| `DOC-SONAR-CHECK-DETAILS-01` | OPERATIVO_EXTERNO | — |
| `AF1-AC-01` | PENDIENTE_OFFLINE | — |
| `AF1-AC-02` | PENDIENTE_OFFLINE | — |
| `AF1-AC-03` | PENDIENTE_OFFLINE | — |
| `AF1-AC-04` | PENDIENTE_OFFLINE | — |
| `AF1-AC-05` | PENDIENTE_OFFLINE | — |
| `ISSUE-257` | OPERATIVO_EXTERNO | — |
| `ISSUE-258` | OPERATIVO_EXTERNO | — |
| `ISSUE-1` | OPERATIVO_EXTERNO | — |
| `ISSUE-122` | OPERATIVO_EXTERNO | — |
| `ISSUE-129` | OPERATIVO_EXTERNO | — |
| `ISSUE-134` | OPERATIVO_EXTERNO | — |
| `ISSUE-216` | OPERATIVO_EXTERNO | — |
| `ISSUE-219` | OPERATIVO_EXTERNO | — |
| `ISSUE-253` | OPERATIVO_EXTERNO | — |
| `ISSUE-255` | OPERATIVO_EXTERNO | — |
| `DEC-D-054` | NORMA_DOCUMENTAL | — |
| `DEC-D-055` | NORMA_DOCUMENTAL | — |
| `DEC-D-056` | NORMA_DOCUMENTAL | — |
| `DEC-D-057` | NORMA_DOCUMENTAL | — |
| `DEC-D-058` | NORMA_DOCUMENTAL | — |
| `DEC-D-059` | NORMA_DOCUMENTAL | — |
| `DEC-D-060` | NORMA_DOCUMENTAL | — |
| `DEC-D-061` | NORMA_DOCUMENTAL | — |
| `DEC-D-062` | NORMA_DOCUMENTAL | — |

## Gates externos y reversión

Las otras 123 filas no reciben promoción. El incidente [#219](https://github.com/pl0n3r/AutoFactory/issues/219) permanece con SonarCloud main Security B / Reliability D (sin inventario nativo autorizado); el verde de un PR no lo sana. #122 necesita smoke Safari/Xcode real; #129–#134 y D-061 siguen sin pairing, tráfico remoto, PII ni activación.

**No es un certificado de runtime**, producción, release, cumplimiento legal o Sonar A/A. No se cambia la matriz histórica, el código de extensión, datos.yml, protección ni versiones. Revertir el PR elimina exclusivamente el informe y la suite.
