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
`createHeartbeatCoordinator({loadVerifiedConsent, snapshot, deliver, now, profileAlias})`
y el método `tick()`. No está cargado desde el manifest, no programa alarmas,
no configura URL ni realiza HTTP por sí mismo. El futuro adaptador deberá
inyectar un `deliver` autenticado y respetar la puerta legal ControlBot#20.

Cada intento requiere una concesión **obtenida de una fuente ya verificada**
con exactamente `{profileAlias, enabled, revoked, expiresAt}`, opt-in
`enabled: true`, no revocada y vigente por un máximo de 24 horas. El
`profileAlias` local confiable se suministra al crear el coordinador; se
compara con la concesión **antes** de invocar `snapshot` y de nuevo antes de
`deliver`. El
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


## Ejecutor autorizado e idempotente (slice 6, aún sin runtime)

`factory-control-executor.js` compone los contratos ya existentes sin añadir
transporte, permisos ni integración con la extensión. El futuro runtime inyectará
un `ledger`, un `authorizer` y exactamente seis handlers de efectos
(`pause|resume|open_chat|set_prompt|set_mode|send_message`).

`execute(input, context)` delega primero en el ledger, que persiste el receipt
`pending` antes de cualquier efecto. Dentro de ese guard, el executor solicita
autorización usando la forma cruda del comando y exige que el resultado autorizado
coincida exactamente con el comando normalizado por el ledger. Si la autorización
falla o intenta alterar ID, acción, destino o payload, el resultado es
`unauthorized` y se persiste como receipt terminal. Así, reutilizar después el
mismo command ID no puede volverlo ejecutable solo porque cambió un grant.

Los efectos reciben una copia congelada del comando autorizado. No pueden mutar el
objeto que usa el ledger para producir el ACK. Excepciones del adapter y outcomes
inválidos se colapsan al código `failed`; no se incluyen mensajes de excepción,
payloads, aliases, tokens ni texto de chat en ACKs o receipts. `target: "all"`
sigue limitado por el protocolo a `pause` y `resume`.

Este corte **no** implementa los efectos reales, no toca `background.js`,
`content.js`, manifests, permisos, Chrome/Safari runtime, pairing, HTTPS ni
endpoints. Tampoco cambia la versión instalable: el módulo permanece aislado
hasta que ControlBot#20 autorice la puerta legal y exista un transporte autenticado.

Evidencia específica:

```sh
node --check factory-control-executor.js
node test-factory-control-executor.cjs
npm test
```

Las regresiones cubren ejecución única, replay tras denegación, broadcast permitido
y prohibido, excepción con secreto, outcome inválido y un authorizer que intenta
cambiar el destino del comando.


## Pairing contract aislado (slice 7, sin pairing real)

`factory-control-pairing.js` añade `createPairingContract(...)` como frontera pura
para el futuro emparejamiento. **No** genera códigos, no valida criptografía por sí
mismo, no guarda llaves, no usa `chrome.storage`, no realiza HTTPS y no modifica
manifest/permisos. La puerta legal ControlBot#20 y D-061 siguen bloqueando cualquier
pairing o tráfico real.

`pair({profileAlias, code})` exige un código decimal de seis dígitos y un alias
local no-email. Después consume dependencias explícitas que el runtime futuro deberá
proveer desde una fuente autenticada:

- `loadVerifiedChallenge`: entrega solo metadata ya verificada
  `{challengeId, profileAlias, expiresAt, revoked, used}`;
- `consumeVerifiedChallenge`: valida/consume atómicamente el código para impedir
  replay. El contrato nunca persiste ni devuelve el código;
- `issueOpaqueCredential`: devuelve únicamente un handle opaco
  `{credentialId, profileAlias, expiresAt}`, con vigencia máxima de 24 horas;
- `revokeOpaqueCredential`: revoca el handle por perfil.

El challenge no puede declarar más de diez minutos de vigencia futura. Estados
revocados, usados o expirados fallan cerrado antes de emitir una credencial. Errores
de adapters se colapsan a códigos fijos
`paired|invalid|expired|replayed|revoked|not_found|failed`: no se exponen códigos,
credenciales, mensajes de excepción ni material sensible.

La protección de replay depende de que `consumeVerifiedChallenge` sea atómico en
la implementación futura. Este slice no afirma autenticación end-to-end, no define
endpoints y no conecta AutoFactory con ControlBot. Evidencia:

```sh
node --check factory-control-pairing.js
node test-factory-control-pairing.cjs
npm test
```


## Contrato de transporte HTTPS (slice 8, sin red activa)

`factory-control-transport.js` define únicamente **descriptores puros** para el
futuro adaptador HTTPS. No llama `fetch`, no resuelve DNS, no abre sockets, no
inyecta credenciales y no modifica manifests o permisos.

El origen es constante e inmutable: `https://control.condorapp.com.co`.
No existe parámetro para sustituirlo. Los únicos paths son:

- `POST /v1/bridge/heartbeat` con heartbeat validado por protocolo v1;
- `GET /v1/bridge/commands/next` con `profileAlias`, cursor opaco y long-poll
  de 25 s por defecto, acotado a 5–30 s;
- `POST /v1/bridge/commands/ack` con ACK validado por protocolo v1.

Los descriptores llevan `authScope: "profile"` como señal abstracta para el
runtime futuro, pero **nunca** incluyen Authorization, bearer, cookie, token,
llave ni secreto. El parser `commandResponse` acepta exactamente
`{cursor, command}`; el comando vuelve a pasar por `protocol.command()` y
rechaza campos extra.

Este contrato reduce la superficie SSRF/path-injection al no aceptar URL, origen
ni path suministrados por remoto. No acredita que esos endpoints existan ni que
ControlBot los implemente todavía. La conexión real, el almacenamiento de
credenciales, el permiso de host y cualquier tráfico siguen bloqueados por
ControlBot#20 y D-061.

Evidencia:

```sh
node --check factory-control-transport.js
node test-factory-control-transport.cjs
npm test
```


## Estado de cuenta normalizado (slice 9, sin DOM/runtime)

`factory-control-account-state.js` define un clasificador puro para señales que un
futuro adapter de proveedor ya haya verificado. No inspecciona DOM, no contiene
selectores, no lee cookies/sesión y no activa red.

Entrada exacta:
`{authenticated, usageLimited, providerError, resetAt}`.

Salida mínima:
`{state, resetAt}`, donde `state` es
`ready|limit|requires_login|error|unknown`.

`limit` acepta `resetAt:null` cuando el proveedor no publica una hora de liberación. Si `resetAt` está presente, debe ser un entero futuro y acotado a siete días. Señales contradictorias, reloj inválido, campos extra o timestamps inválidos fallan a `unknown`. No se aceptan mensajes libres, email, URLs, cookies, tokens ni IDs de
chat, por lo que el resultado puede incorporarse al heartbeat sin filtrar texto.

Este módulo **no detecta por sí mismo** mensajes ES/EN. Esa detección pertenecerá al
adapter de proveedor futuro, que deberá convertir la UI a estas señales tipadas y
seguir respetando ControlBot#20/D-061.

Evidencia:

```sh
node --check factory-control-account-state.js
node test-factory-control-account-state.cjs
npm test
```


## Consentimiento para devolución de respuesta (slice 10, sin contenido real)

`factory-control-response-consent.js` define un contrato puro de decisión para la
futura función opt-in que devolvería la última respuesta completa al centro. Este
slice **no** lee DOM, no captura respuestas, no almacena texto y no realiza red.

`authorize({profileAlias})` consulta una concesión ya verificada e inyectada por
el runtime futuro. Esa concesión debe contener exactamente
`{profileAlias, purpose, enabled, revoked, expiresAt}`, con propósito fijo
`response_return`, opt-in explícito, mismo perfil, no revocada y vigencia máxima
de una hora. Cualquier ausencia, drift, expiración o error falla cerrado.

El resultado solo puede ser `{allowed, code}`, con códigos
`allowed|denied|invalid|failed`. Nunca incluye contenido de chat, token, email,
URL, ID de conversación, excepción ni secreto. Este contrato no sustituye la
puerta legal ni el consentimiento verificable end-to-end; ControlBot#20 y D-061
mantienen bloqueado cualquier tratamiento o tráfico real.

Evidencia:

```sh
node --check factory-control-response-consent.js
node test-factory-control-response-consent.cjs
npm test
```


## Persistencia local de credencial opaca (slice 12, sin pairing activo)

`factory-control-chrome-storage.js` también exporta
`createChromeProfileCredentialStore({local, runtime, now})`. Este adapter
permanece aislado del runtime y no cambia manifests, permisos ni endpoints.

El store usa la clave `factoryControlProfileCredentialsV1` y conserva como
máximo una entrada por perfil con exactamente
`{profileAlias, id, expiresAt}`. El alias debe ser local y no-email; el ID es
un handle opaco y la vigencia al guardar no puede superar 24 horas. No se
almacenan códigos de pairing, texto de chat, cookies, sesiones, mensajes de
excepción ni material criptográfico.

`load(profileAlias)` solo devuelve `{id, expiresAt}` para el perfil exacto
y una credencial aún vigente. Una entrada expirada queda inutilizable pero
puede eliminarse explícitamente. `remove({profileAlias,id})` exige coincidencia
exacta de perfil e ID, de modo que un perfil no puede borrar el handle de otro.

Los arrays corruptos, dispersos, duplicados o con campos extra fallan cerrado.
Los detalles de `chrome.runtime.lastError` se sustituyen por errores genéricos.
El update es read-modify-write y no ofrece compare-and-swap; por eso este corte
no afirma exclusión entre múltiples workers concurrentes.

La pieza no está conectada a `factory-control-pairing.js`, no contiene
credenciales reales y no habilita tráfico. La conexión pairing → storage y
cualquier tratamiento real siguen bloqueados por ControlBot#20 y D-061.


## Pairing persistido por perfil (slice 13, composición pura)

`createPersistedPairingContract({pairing, credentialStore})` une los dos contratos
ya existentes sin activar el runtime. El `pairing` inyectado debe exponer
`pair/revoke` y el store solo `save/remove`; este corte no importa Chrome,
no usa `fetch`, no conoce endpoints y no modifica permisos o manifests.

Cuando `pair()` devuelve `paired`, el wrapper guarda exclusivamente
`{profileAlias,id,expiresAt}`. Si ese guardado falla después de emitir el
handle, intenta una revocación compensatoria y siempre devuelve
`{ok:false,code:"failed"}`, sin propagar excepciones, el código de seis
dígitos ni el identificador de credencial.

En `revoke()`, un fallo remoto conserva la copia local para permitir reintento.
Solo después de `revoked` o `not_found` se intenta retirar el handle local.
Si la limpieza local falla, el resultado se degrada a `failed` para evitar
declarar revocación completa mientras persiste estado local obsoleto.

No se añade tratamiento de datos: el único registro persistido sigue siendo
`local_factory_control_profile_credential` de `datos.yml`, con los mismos
campos, propósito, retención y proveedor vacío. ControlBot#20 está completado,
pero D-061 sigue exigiendo consentimiento verificable, autenticación y validación
de seguridad antes de pairing/tráfico real o go-live.


## Transporte ligado a credencial opaca (slice 14, sin red activa)

`createCredentialBoundInvoker({credentialStore, invoke, now})` compone el store
local con los descriptores HTTPS sin implementar `fetch` ni activar permisos.
La API pública recibe `{profileAlias,request}`; valida que el descriptor pertenezca
al origen fijo y a uno de los tres métodos/paths ya definidos por el contrato.

La credencial se carga por alias dentro de la frontera y debe tener exactamente
`{id,expiresAt}`, estar vigente y no superar 24 horas de horizonte. El handle
opaco solo se entrega al adapter confiable `invoke({credentialId,request})`;
nunca forma parte del descriptor, del resultado público ni de un error.

El adapter debe devolver exactamente `{status,body}` con status HTTP válido.
Si una respuesta refleja accidentalmente el credential id, el wrapper falla
cerrado. Ausencia/expiración devuelve `unauthorized`; corrupción, excepción,
reloj inválido, descriptor adulterado o respuesta inválida devuelve `failed`.
Ningún mensaje de excepción se propaga.

Este slice no añade persistencia ni campos a `datos.yml`, no incorpora proveedor
concreto, no hace DNS/HTTP y no toca manifest/background. D-061 sigue bloqueando
tráfico real y go-live hasta consentimiento verificable, autenticación y revisión
de seguridad end-to-end.


## Cliente autenticado de transporte (slice 15, composición pura)

`createAuthenticatedTransportClient({transport, invoker})` une el contrato de
descriptores con el invoker credential-bound sin implementar red. Captura las
funciones inyectadas al construir la fachada y snapshottea cada input antes de
validarlo, por lo que una mutación del caller durante un `await` no cambia el
descriptor ya autorizado.

La fachada expone solo tres operaciones cerradas:

- `sendHeartbeat(payload)`: genera el descriptor heartbeat fijo y acepta como
  entrega únicamente HTTP 200/204;
- `nextCommand({profileAlias,cursor})`: genera el long-poll fijo; HTTP 204
  produce `empty` y HTTP 200 debe pasar por `commandResponse` antes de
  devolver un comando normalizado;
- `sendAck({profileAlias,ack})`: genera el descriptor ACK fijo y acepta solo
  HTTP 200/204.

El caller no puede suministrar origen, path, método, token, credential id ni
headers. Los bodies de heartbeat/ACK no se devuelven al caller. Errores,
statuses inesperados, responses adulteradas o excepciones se colapsan a
`{ok:false,code:"failed"}`; una falta de credencial puede propagarse solo como
`unauthorized`.

Este slice sigue sin `fetch`, DNS, AbortController, alarms, background,
manifest, host permissions ni tráfico real. No cambia `datos.yml`. D-061
continúa bloqueando activación y go-live hasta completar consentimiento,
autenticación y revisión de seguridad end-to-end.


## Pump de órdenes autenticadas (slice 16, sin runtime)

`createCommandPump({client, executor})` compone el cliente autenticado del slice 15
con el executor idempotente ya existente. No implementa timers, alarms, background,
fetch ni efectos reales.

`runOnce({profileAlias,cursor,context})` snapshottea su entrada antes de cualquier
`await`, exige que `context.profileAlias` coincida con el perfil y serializa una
sola ejecución por instancia. Un segundo `runOnce` concurrente recibe `busy`.

El flujo es cerrado:

1. solicita exactamente un `nextCommand`;
2. si está vacío, no ejecuta efectos ni ACK;
3. si llega un comando, llama una vez a `executor.execute`;
4. valida el ACK mínimo producido por el executor;
5. envía ese ACK mediante `client.sendAck`;
6. **solo después de ACK enviado** devuelve el cursor nuevo.

Si el efecto ya fue procesado, el ledger del executor puede devolver
`already_handled` y el pump vuelve a ACK sin repetir el efecto. Si el ACK falla,
el resultado conserva el cursor anterior con `ack_failed`, de modo que el caller
debe repetir el poll desde el mismo punto y no confirmar avance local.

Los resultados del pump nunca incluyen payload, texto de chat, grants, token,
credential id ni excepciones de adapters. Este slice sigue aislado del runtime y
no modifica `datos.yml`; D-061 mantiene bloqueados red, alarms, permisos y go-live.


## Señal local de estado de cuenta (slice 17, sin DOM ni red)

`factory-control-account-state.js` amplía el clasificador normalizado del slice 9
para consumir una señal ya detectada localmente por la extensión, sin leer el DOM,
almacenar textos ni activar transporte.

`classifyProviderPageSignal({signalCode, alertText}, now)` acepta únicamente
`ready|authentication|rate-limit|connection`. Las señales se reducen a la salida
mínima `{state,resetAt}`:

- `ready` → `ready`;
- `authentication` → `requires_login`;
- `connection` → `error`;
- `rate-limit` → `limit`, incluso cuando el aviso no publica hora.

Para un `rate-limit`, `alertText` se procesa solo en memoria y se descarta.
Si contiene exactamente una hora válida en formato 24 h o AM/PM —incluyendo
`a. m.`/`p. m.`— el contrato calcula la próxima ocurrencia en la zona horaria
local del navegador y la expone como `resetAt`. Si la hora no aparece, es
ambigua o inválida, conserva `resetAt:null` en vez de inventar una fecha.

El texto está limitado a 500 caracteres y nunca forma parte del resultado. Campos
extra, señales fuera del vocabulario cerrado o un reloj inválido fallan a
`unknown`. `classifyAccountState()` ahora permite explícitamente
`{usageLimited:true,resetAt:null}`, porque la hora de liberación es opcional en
la UI.

Este slice reutiliza la detección ES/EN que ya existe en
`autopilot-core.pageSignal()`, pero todavía no conecta ambos módulos dentro de
`content.js` ni modifica `background.js`, manifest, permisos, alarms o red.
No añade persistencia ni cambia `datos.yml`; D-061 continúa bloqueando tráfico
real y go-live.


## Preflight de activación del puente (slice 18, aún sin runtime)

`factory-control-activation.js` añade una frontera pura para decidir si un futuro
transporte puede **intentar activarse**. No crea pairing, no autentica por sí mismo,
no realiza HTTP y no modifica manifest, background, permisos ni tratamientos.

`createActivationPreflight({loadVerifiedPairing, loadVerifiedHeartbeatConsent,
loadVerifiedLegalGate, now})` exige, para el mismo `profileAlias`:

- pairing ya verificado, no revocado y vigente;
- consentimiento de heartbeat ya verificado, con propósito fijo `heartbeat`, habilitado, no revocado y vigente;
- puerta legal ya verificada, con propósito fijo `factory_control_bridge_activation`, permitida, no revocada y vigente.

Los tres snapshots tienen expiración máxima de 24 horas. El preflight vuelve a
comprobar pairing y consentimiento con el reloj más reciente antes de devolver
`ready`, para no aprobar material que haya expirado durante las lecturas
asíncronas. Un reloj regresivo o un snapshot mal formado falla cerrado.

La salida contiene únicamente `{allowed, code}`, con códigos
`ready|unpaired|consent_denied|legal_blocked|invalid|failed`. Nunca devuelve
credential IDs, aliases, detalles de la puerta legal, excepciones, tokens ni texto
de chat. `ready` **no significa go-live**: el futuro runtime todavía deberá
autenticar transporte, aplicar autorización por orden, response consent cuando
corresponda, AbortSignal/revocación y la puerta ControlBot#20. D-061 sigue vigente.

Evidencia específica:

```sh
node --check factory-control-activation.js
node test-factory-control-activation.cjs
npm test
```
