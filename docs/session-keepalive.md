# Política offline de continuidad por chat (Factory #163)

Estado: **módulo puro de preparación**, sin conexión al runtime de la extensión, sin envío de mensajes y sin permisos de red, almacenamiento o UI.

## Qué decide

`factory-control-session-keepalive.js` expone `evaluate(snapshot, now_s)` y `createPolicy({now}).decide(snapshot)` con reloj inyectado. Devuelve una de `esperar`, `reenganchar` o `detener`. **`reenganchar` solo es una recomendación**, no un clic, reintento ni autorización para usar la cuenta. Los consumidores deberán volver a comprobar el estado y las guardas del proveedor justo antes de cualquier envío.

Por defecto **el módulo está desconectado y no hay flag de popup activado**. La integración del interruptor apagado por defecto deberá reclamarse aparte en `popup.js`/espejo Safari si los paths están libres y se documentan las puertas correspondientes.

## Evidencia requerida

- `chat`: `reservation_active`, `reply_complete`, `last_prompt_s`, `last_reply_s`, `last_activity_s`, `last_reply_chars`, `msgs_hour`, `state` y `identical_read_count` (mínimo dos lecturas iguales).
- `account`: `observed_limit_hour` conocido, `msgs_hour` y `usage_limited`; saldo permitido como máximo 80 % del límite observado. No se deducen límites de un plan o de la velocidad de respuesta.
- `controls`: `enabled`, `manual_pause`, `kill_switch_running`, `circuit_breaker_open`, `ambiguous_send`, `session_closed`.
- `history.retries_s`: instantes **atestiguados** de intentos de continuación, ordenados, sin duplicados y conservados por el adaptador responsable. Ventana móvil de 3600 s, máximo 3 intentos, con espera exponencial. Al terminar el backoff, o incluso después de vencer la ventana de una hora, un intento posterior a la última respuesta completada sigue siendo **incierto**: se devuelve `detener/desconocido` hasta tener evidencia de respuesta observada; el reloj por sí solo no autoriza reenvío.

Las fechas son segundos Unix enteros UTC. Se exige pacing mínimo de 60 segundos desde el último prompt, configurable con `controls.min_pacing_s` entre 60 y 3600 segundos (un valor inválido detiene la sugerencia) y al menos 600 segundos sin actividad después de una respuesta terminada. Los relojes inválidos, cuotas desconocidas, confirmación ambigua y señales contradictorias fallan cerrado; nunca prueban que otro agente abandonó el trabajo.

## Motivos y telemetría limitada

El resultado publica únicamente `last_prompt_s`, `last_reply_s`, `last_reply_chars`, `msgs_hour`, `state`, `idle_reason`, `idle_since`, `next_allowed_s` y, si fuese elegible, el texto estándar fijo. Razones posibles: `activo`, `esperando_pacing`, `limite_horario`, `circuit_breaker`, `envio_ambiguo_5min`, `sesion_cerrada`, `pausa_manual`, `sin_trabajo` y `desconocido`.

No enviar prompts reales, contenido de chats, correos, URLs, cuentas, cookies, tokens ni identificadores al orquestador. No simular presupuesto, no resolver captchas, no eludir las cuotas de la plataforma. Una reserva V3 y un reloj observados no sustituyen el consentimiento ni los controles del navegador.

## Verificación sin efectos

`node test-factory-control-session-keepalive.cjs` y `python3 -m unittest tests.test_factory_control_session_keepalive` ejecutan fakes deterministas. Los tests no prueban instalación de Chrome/Safari, telemetry live, validación de límites por proveedor ni que un mensaje fuese enviado. El wiring futuro necesita sus propias claims y pruebas de integración.
