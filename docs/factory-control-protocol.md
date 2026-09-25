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
