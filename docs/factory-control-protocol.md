# Contrato del puente AutoFactory ↔ ControlBot · fase 0

Esta fase implementa **solamente validadores puros** para el futuro puente HTTPS.
No conecta la extensión a ControlBot, no empareja perfiles, no añade permisos
de host y no ejecuta órdenes remotas. El servicio ControlBot y el runtime deben
acordar los nombres finales de sus endpoints antes de conectarse.

## Decisión vigente

Según el ajuste de AutoFactory#1, ControlBot reside en Hostinger bajo
`https://control.condorapp.com.co`: latido `POST` cada 60 s, consulta
HTTPS de órdenes con long-polling de aproximadamente 25 s y confirmación
`POST`. No se implementa WebSocket ni native messaging para esta conexión.
El permiso de host, cuando sea necesario, debe cubrir **solo** este origen.

## Módulo compartido

`factory-control-protocol.js` funciona en el navegador
(`ChatGPTAutopilotFactoryProtocol`) y en Node (`require(...)`).
Exporta `VERSION=1` y tres funciones que **rechazan** campos desconocidos:

- `heartbeat({profileAlias, accountAlias, tabs, lastEvent})`:
  alias cortos sin formato de correo, hasta 40 pestañas, identificadores enteros
  únicos, indicador `enabled`, estado
  `paused|waiting|generating|sending|error|limit|requires_login`,
  y código de evento alfanumérico corto o `null`. Rechaza arrays de
  pestañas dispersos antes de emitir un latido para no producir un estado
  parcial. No acepta URL, ruta de
  conversación, correo, token ni texto del chat.
- `command({id, action, target, payload?})`: solo
  `pause|resume|open_chat|set_prompt|set_mode|send_message`.
  El destino es `all` **solo para pausar/reanudar**, o un ID numérico de pestaña para las demás acciones. `set_mode`
  admite `chat|work`; `set_prompt` y `send_message` admiten texto
  no vacío de hasta 16 000 caracteres. El texto de una orden no puede
  incorporarse al latido, ACK ni registro de diagnóstico.
- `acknowledgement({id, ok, code})`: devuelve únicamente ID de orden,
  resultado booleano y uno de
  `ok|invalid|not_found|not_ready|timeout|unauthorized|already_handled|failed`.
  Rechaza mensajes de excepción arbitrarios.

Los tres resultados incluyen `version` y `kind` como discriminadores.
Los IDs de orden son obligatorios: **el futuro ejecutor** deberá persistir
un registro acotado de IDs completados para impedir reenvíos duplicados. Este
módulo valida la forma del ID, pero no afirma ofrecer deduplicación por sí solo.

## Límite de confianza

Un JSON bien formado no es autorización. El futuro runtime **debe**
verificar emparejamiento, autenticación, permisos por perfil, vigencia de
orden, destino y consentimiento del dueño antes de cada operación.
No debe registrar ni retransmitir `payload.text`. No se automatizan
login, captcha, pagos ni aprobaciones sensibles.

## Evidencia y reversión

```sh
node --check factory-control-protocol.js
node test-factory-control.cjs
npm test
```

`npm test` incorpora la nueva prueba con el resto del suite cuando
están instaladas las dependencias. Para revertir esta fase basta revertir
el PR: aún no modifica el runtime de Chrome/Safari ni los permisos.


## Protección contra reintentos (slice 2)

`factory-control-ledger.js` añade `createLedger({load, save, maxEntries})`,
con un almacenamiento asíncrono inyectado que **debe ser durable** para
sobrevivir a suspensiones del service worker MV3. `execute(command, handler)`
valida el comando del contrato v1, persiste un recibo `pending` **antes**
de invocar el handler, y guarda únicamente `{id, state, code}`.
Un ID pendiente tras una interrupción responde `not_ready`; un ID ya
terminado responde `already_handled`. Nunca guarda `payload.text`,
secretos ni mensajes de excepciones.

El ledger valida que la lista cargada sea densa y que cada recibo sea válido;
si el adaptador entrega arrays dispersos/corruptos falla antes del guardado de
`pending` y antes del handler, independientemente del adapter Chrome.

El historial tiene capacidad máxima configurable (por defecto 256), y
**falla cerrado al llenarse**: jamás elimina recibos en silencio, pues
esa eliminación permitiría volver a ejecutar un ID antiguo. La rotación
solo puede realizarse en un protocolo posterior coordinado con el servidor,
después de confirmar una frontera segura de órdenes ya descartadas.

**Garantía exacta:** no repetición por ID retenido en una sola instancia
con almacenamiento durable y guardado exitoso. No garantiza entrega
exactamente una vez ni exclusión mutua entre múltiples instancias
independientes usando almacenamiento sin compare-and-swap. Un proceso
interrumpido tras guardar `pending` puede no haber invocado el handler;
el dueño o el futuro servidor deben reconciliar la operación antes de
decidir una nueva orden. Autenticación, autorización, opt-in y control
de destinos siguen siendo responsabilidad del runtime posterior.

## Almacenamiento persistible en Chrome (slice 3, aún sin runtime)

`factory-control-chrome-storage.js` exporta `createChromeReceiptStore({local, runtime})`.
Un futuro service worker podrá pasar explícitamente `chrome.storage.local` y
`chrome.runtime` como dependencias del ledger existente. No se carga el
módulo desde `manifest.json` ni se registra un handler remoto en este corte.

Se usa **solo** la clave `factoryControlCommandReceiptsV1`: cada recibo
contiene exactamente `id`, `state` y `code`, con límites para IDs y
códigos. El adaptador rechaza colecciones inválidas, duplicadas o demasiado
grandes antes de guardar o de devolverlas al ledger. Nunca almacena
`payload.text`, aliases, URLs de chats, llaves ni mensajes de excepción.
Los errores de `chrome.runtime.lastError` se convierten en un código
genérico de fallo de almacenamiento, sin exponer detalles potencialmente
sensibles. Si falla el guardado del marcador `pending`, el ledger **no**
invoca el handler. Si encuentra `pending` de una sesión anterior, mantiene
`not_ready` hasta reconciliación, sin reejecución silenciosa.

**Límites de garantía:** el callback de `chrome.storage.local.set` confirma
el resultado de la operación para el almacenamiento local, no una
transacción distribuida ni entrega exactamente una vez. El ledger serializa
llamadas de **una instancia**; no excluye simultaneidad de dos workers o
perfiles contra el mismo almacenamiento sin un mecanismo de bloqueo/CAS.
El servicio futuro debe reconciliar IDs pendientes, autenticar y autorizar
cada orden, acotar el historial y gestionar su rotación con seguridad.
Nada de esto habilita tráfico real ni modifica permisos del navegador.
La puerta legal `pl0n3r/ControlBot#20` continúa sin resolver.


## Preflight local por perfil y acción (slice 4, aún sin runtime)

`factory-control-authorization.js` exporta
`createCommandAuthorizer({loadVerifiedGrant, now})`. El consumidor futuro
deberá autenticar la procedencia de cada orden, verificar criptográficamente
el emparejamiento y recién entonces proporcionar
`loadVerifiedGrant(): Promise<grant>` desde almacenamiento local confiable.
El `grant` puro contiene exactamente
`{profileAlias, expiresAt, revoked, actions, tabIds, broadcast}`, sin
llave, correo, URL ni texto de chat. No se crea, guarda ni transmite una
concesión en este corte. La presencia de un objeto con esos campos **no**
demuestra una firma ni una sesión; ese límite pertenece al runtime y al
servidor futuros.

`authorize(command, {profileAlias, enabledTabIds})` reutiliza el validador
del protocolo y rechaza cualquier concesión ausente, corrupta, revocada,
expirada (o con vencimiento mayor a 24 horas), de otro perfil o sin acción
autorizada. Una orden para un tab numérico necesita permiso para ese tab
**y** que esté habilitado localmente. `target: "all"` requiere permiso
`broadcast: true` explícito y el protocolo solo lo admite para pausar o
reanudar, nunca para enviar mensajes ni cambiar prompts o modos.
Todo rechazo tiene texto fijo `Command not authorized`: ni el prompt,
ni el alias, ni una excepción del adapter se incorporan al diagnóstico.

Un test independiente del almacenamiento y del navegador se integra en
`npm test` a través de `test-factory-control-ledger.cjs`. La autorización
puramente local **no** sustituye la verificación del dueño, antifalsificación,
revocación server-side, integridad de órdenes, controles de sesión o
consentimiento legal. La puerta ControlBot#20 mantiene no-go-live.


## Coordinador de latido (slice 5, sin transporte activo)

`factory-control-heartbeat.js` ofrece
`createHeartbeatCoordinator({loadVerifiedConsent, snapshot, deliver, now})`
y el método `tick()`. No está cargado desde el manifest, no programa alarmas,
no configura URL ni realiza HTTP por sí mismo. El futuro adaptador deberá
inyectar un `deliver` autenticado y respetar la puerta legal ControlBot#20.

Cada intento requiere una concesión **obtenida de una fuente ya verificada**
con exactamente `{profileAlias, enabled, revoked, expiresAt}`, opt-in
`enabled: true`, no revocada y vigente por un máximo de 24 horas. El
coordinador no crea ni certifica consentimientos o identidades y no
persistirá datos nuevos. Consulta la concesión antes de pedir el snapshot
y la verifica otra vez después, antes de entregar, para detectar revocación
durante la captura. Si falla, no llama a `deliver`.

El snapshot siempre se valida con `protocol.heartbeat()` y debe tener
el mismo perfil autorizado. Solo sale el objeto v1 con alias no correo,
estados de pestañas y código breve de evento. No se retransmiten URLs,
tokens, texto de chat ni los detalles de excepciones del adaptador.

El ritmo mínimo es **60 000 ms entre inicios de intento**, incluso si
hay un error de lectura o entrega; llamadas simultáneas se descartan como
`busy`. El método `stop()` bloquea nuevos intentos e impide entregar
si se invoca durante la lectura de consentimiento o snapshot. No puede
cancelar una petición de transporte **ya iniciada**: al activar el bridge,
el runtime tendrá que inyectar `AbortSignal` y coordinar su revocación.

Los resultados son solo `sent|denied|failed|busy|throttled|stopped`.
`sent` significa que el adaptador inyectado resolvió su promesa, **no**
que ControlBot haya confirmado un latido real en producción.
