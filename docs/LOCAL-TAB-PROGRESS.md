# Señal local de pestaña SIN AVANCE — contrato offline

Fuente: AutoFactory #246, autorizada como preparación local por #243/A. Esta
implementación **no está integrada ni activada** en el runtime Chrome/Safari, no
abre permisos, no realiza red, no genera un estado remoto y no toma decisiones
de envío o de reintento. D-061 y #242/B permanecen vigentes.

`classifyTabProgress(input)` devuelve solo uno de `ACTIVA`, `SIN_AVANCE` o
`UNKNOWN`. Requiere milisegundos enteros y no negativos para `nowMs`,
`lastActivityAtMs`, `fingerprintStableSinceMs` y `thresholdMs` (>0), dos
huellas opacas SHA-256 en hexadecimal minúscula y un booleano opcional
`activityObserved`. Tiempos futuros, campos ausentes, digests no opacos y
valores mal formados devuelven `UNKNOWN`. Si la huella cambia o se confirma
actividad reciente, devuelve `ACTIVA`; `SIN_AVANCE` requiere huella estable y
al menos un umbral completo desde **ambas** fuentes de progreso observadas.

La API solo consume estos campos técnicos. No recibe ni registra texto de
conversaciones, tokens, cookies, correos, ID de conversación ni rutas de chat.
No hay almacenamiento ni timers; un consumidor futuro deberá diseñar el
umbral y la obtención de huellas con autorización y pruebas propias.

## Pruebas reproducibles

```bash
node test-local-tab-progress.cjs
python3 -m unittest tests.test_local_tab_progress
```

`tests/test_local_tab_progress.py` es únicamente el puente de aceptación del
kit Factory v1, que exige `tests/test_*.py::Clase::test_metodo`: ejecuta los
mismos casos Node, no duplica la implementación. El check de Validate **no**
ejecuta automáticamente este archivo Node mediante `npm test` mientras
`package.json` esté reclamado por otra reserva V3. Antes de marcar AC-03
completado debe haber evidencia explícita de ejecución en CI y cumplirse las
puertas #219/#220 y D-069. No confundir la prueba offline con Safari real,
extensión instalada ni producción verificada.
