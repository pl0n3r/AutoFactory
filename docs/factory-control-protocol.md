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
  y código de evento alfanumérico corto o `null`. No acepta URL, ruta de
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
