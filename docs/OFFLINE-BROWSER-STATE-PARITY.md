# Paridad offline de estados Chrome/Safari (AutoFactory #228)

Este contrato compara **fuentes reales del repositorio** con fixtures sintéticos
por Node.js, sin navegador, datos de usuario, emparejamiento ni conexión de red.

## Cobertura

- Estado de cuenta `ready`, `limit`, `requires_login`, `error`, `unknown`:
  se serializa con `factory-control-protocol.js::heartbeat` tanto desde
  Chrome como desde su espejo Safari. Se comprueba igualdad, shape mínima,
  y rechazo de estados/campos no permitidos.
- Derivación local de readiness: solo `ready` fresco puede producir el
  diagnóstico `ready=true`; límites, login, error, unknown, evidencia
  `STALE` (>180 s) y evidencia del futuro fallan cerrado.
- Se cotejan bytes de los tres módulos compartidos de protocolo, autorización
  y runtime en ambos árboles. Sin grant verificado, ambos autorizadores
  rechazan una orden sintética; los runtimes no iniciados no ejecutan el
  puerto de comandos.
- Se inicia una sesión **sintética activa** en cada runtime, con grant válido
  de corta duración y contextos de pestaña permitidos. El *pump* offline
  verifica readiness antes de proponer comandos; `limit`, `requires_login`,
  `error`, `unknown`, `STALE` y tiempo futuro deben producir **cero propuestas**.
  El control positivo comprueba que el grant no sea la causa del rechazo.
  Esta prueba de integración simulada no acredita que el runtime productivo
  haya conectado esa guarda ni autoriza tráfico real.
- Además se invoca el **ejecutor real** con ledger y autorizador reales de
  Chrome/Safari bajo fixtures sin red. Incluso cuando el estado denegado intenta
  ejecutar el comando, el autorizador debe responder `unauthorized` y mantener
  **cero efectos**; el control positivo `ready` causa exactamente un efecto
  contador (sin navegador) y el replay queda en `already_handled`. El informe
  de readiness que suministra/retira el grant es **solo un fixture**: no prueba
  cableado productivo ni autoriza tráfico real. Safari comparte el ejecutor de
  prueba, pero usa su autorizador y ledger espejados.
- Ejecución: `python3 -m unittest tests.test_offline_browser_state_parity -v`
  y como parte de `npm test`; sin alterar otros tests ni flags.

## Frontera de confianza y límites

El informe `factory-control-readiness-report.js` es un **diagnóstico puro**
usado sobre señales sintéticas, no certifica permiso de ejecutar acciones.
Las pruebas no inician extensiones ni Safari/Xcode interactivo y **no**
acreditan #122, #129, #132, tratamiento de usuarios reales, operación
remota, consentimiento, publicación o go-live. La decisión D-061 sigue
cerrada, y las puertas #219 (Sonar) y #220 (ruleset) siguen independientes
para cualquier fusión.
