# Pruebas offline de denegación de estado de sesión (#226)

## Autoridad y alcance

Primera hoja de QA aprobada explícitamente por el propietario en AutoFactory #225, opción A con journal bot #6301813194. El permiso abarca preparación local sintética, no activación, integración con ControlBot ni publicación. Mantener D-061 y la decisión B de ControlBot #653.

## Qué se comprueba

- factory-control-session-keepalive.js::evaluate deniega propuestas de reenganche si la sesión está cerrada, el presupuesto agotado, el interruptor pausado o la observación es desconocida/caducada; una respuesta pendiente solo permite esperar.
- factory-control-account-state.js reduce señales inconsistentes o caducadas a unknown y trata un límite observado como limit.
- El observador real `createProviderAccountStateObserver` verifica el borde de frescura (1.000 ms), rechaza observaciones anteriores al límite, timestamps futuros y campos extra identificables; todos los casos usan señales sintéticas.
- Los diagnósticos resultantes exponen únicamente métricas no identificables. Las propiedades sintéticas adicionales con texto de conversación, correo, token e identificador nunca se exportan.

Los tests llaman a los módulos JS reales desde Python unittest mediante node -e, sin servidor, navegador, API, cuenta, PII, sesión, cookies, claves ni paquetes externos.

## Ejecutar

    python3 -m unittest tests.test_offline_session_state_denials -v
    npm test

El comando npm test conserva todas las suites anteriores y añade las nuevas pruebas. El check canónico es test del workflow Validate, sobre el SHA exacto del PR.

## Gates pendientes y reversión

No interpretar estas pruebas como smoke real de Safari, E2E de pairing ni garantía de no tráfico de runtime activado. Antes de fusionar, #220 debe aportar protección real de main; #219 debe disponer de hallazgos Sonar autenticados y resolver los graves conforme D-069; revisar CodeRabbit exclusivamente al final con CI verde. La tarea es reversible mediante revert de su squash y no altera código productivo ni permisos.
