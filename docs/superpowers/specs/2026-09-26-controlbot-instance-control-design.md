# Control individual de instancias desde ControlBot

Fecha: 2026-09-26
Estado: diseño aprobado, pendiente de plan e implementación
Productos: AutoFactory y ControlBot

## Objetivo

Permitir que ControlBot pause o reanude cada instancia de AutoFactory por navegador/perfil, tanto desde el mismo Mac como desde otro dispositivo. Chrome y Safari deben aparecer y responder como unidades independientes. Todas las pestañas de ChatGPT pertenecientes a una instancia obedecen juntas.

## Alcance inicial

Incluye registro, presencia, estado, pausa y reanudación individual o global, recibos idempotentes, emparejamiento y revocación. No incluye lectura de conversaciones, envío de mensajes, cambio de modelo, control del sistema operativo ni ejecución arbitraria.

## Arquitectura

### ControlBot

Mantiene el inventario autorizado de instancias y presenta una tarjeta por navegador/perfil. Emite comandos dirigidos y actualiza el estado únicamente al recibir confirmación válida.

### Agente local AutoFactory

Proceso ligero residente en el Mac. Es el único puente entre ControlBot y las extensiones. Descubre las instancias emparejadas, conserva el canal local, entrega comandos y transmite presencia técnica. Nunca expone un puerto públicamente.

### Extensiones Chrome y Safari

Cada instalación genera una identidad estable y no sensible. Publica estado técnico al agente local y aplica `pause` o `resume` a todas sus pestañas. Safari y Chrome comparten el mismo contrato, manteniendo implementaciones de transporte adaptadas a cada navegador.

### Relay remoto

Canal saliente autenticado desde el agente local hacia el servicio de ControlBot. Permite control remoto sin conexiones entrantes al Mac. El mismo motor de autorización procesa órdenes locales y remotas.

## Identidad

Cada instancia se identifica mediante:

- `instanceId`: UUID aleatorio estable, generado localmente.
- `browser`: `chrome` o `safari`.
- `profileAlias`: alias visible elegido durante el emparejamiento; nunca correo electrónico.
- `deviceAlias`: nombre corto del equipo definido por el usuario.
- `extensionVersion` y `protocolVersion`.

La clave visual recomendada es `deviceAlias — browser — profileAlias`. Los IDs internos no se muestran salvo en diagnóstico técnico.

## Emparejamiento y credenciales

1. ControlBot genera un código temporal de un solo uso.
2. El usuario lo confirma en el agente local.
3. Ambas partes intercambian claves públicas y un identificador de concesión.
4. La concesión enumera instancias y acciones permitidas, vence como máximo en 24 horas y puede renovarse de forma explícita.
5. Las claves privadas permanecen en Keychain de macOS; las extensiones no reciben credenciales del relay.
6. Revocar una instancia invalida inmediatamente su concesión y corta el canal.

La activación exige consentimiento verificable y la puerta legal de ControlBot#20. No se habilitan endpoints ni datos reales antes de cumplirla.

## Transporte

### Local

El agente expone un canal limitado a loopback o mensajería nativa del navegador. Acepta únicamente el protocolo versionado y valida el origen de cada cliente. No usa puertos accesibles desde la LAN.

### Remoto

El agente abre una conexión saliente persistente TLS al relay. Cada mensaje está firmado, contiene `commandId`, `instanceId`, acción, emisión y vencimiento. El relay no puede ampliar permisos ni convertir una orden dirigida en global.

## Protocolo

### Presencia

Cada instancia informa como máximo una vez por minuto:

```json
{
  "instanceId": "uuid",
  "browser": "chrome",
  "enabled": true,
  "state": "waiting",
  "tabCount": 3,
  "extensionVersion": "1.6.6",
  "lastEvent": "cycle-complete"
}
```

No contiene URLs, títulos, prompts, mensajes, identificadores de chats, cuentas ni correos.

### Comando

```json
{
  "id": "command-id",
  "action": "pause",
  "target": "instance-uuid",
  "issuedAt": 0,
  "expiresAt": 0
}
```

`pause` y `resume` admiten una instancia o el destino global autorizado. Un comando vencido, repetido, no firmado o fuera de concesión falla cerrado.

### Confirmación

```json
{
  "id": "command-id",
  "instanceId": "instance-uuid",
  "ok": true,
  "code": "ok",
  "enabled": false,
  "appliedTabs": 3
}
```

ControlBot cambia la tarjeta al estado definitivo solo después de validar este recibo.

## Estados de interfaz

Cada tarjeta muestra:

- nombre de instancia;
- Activo, Pausado, Ejecutando, Error o Desconectado;
- versión, pestañas, última conexión y último ciclo;
- botón grande `PAUSAR` o `REANUDAR`;
- progreso `Enviando`, `Recibido` y `Confirmado`.

Si no llega recibo, la tarjeta muestra `Sin respuesta`; conserva el último estado conocido con su antigüedad y ofrece reintento. El control global presenta resultados por instancia y no oculta fallos parciales.

## Aplicación del comando

El agente autentica al emisor, valida el protocolo y reserva el `commandId` en el ledger antes de producir efectos. Luego entrega la orden a una sola instancia. La extensión actualiza su estado maestro, lo propaga a todas sus pestañas y responde con el número aplicado. El ledger convierte reintentos en respuestas idempotentes y evita una segunda ejecución.

## Recuperación y errores

- Instancia desconectada: `not_ready`, sin cambiar el estado mostrado a éxito.
- Instancia inexistente o revocada: `not_found` o `unauthorized` sin revelar inventario adicional.
- Recibo perdido: el reintento devuelve el resultado persistido.
- Reinicio del agente: restaura identidades, concesiones y recibos pendientes desde almacenamiento seguro.
- Fallo parcial al propagar pestañas: `failed`; el estado se vuelve a consultar antes de permitir otro comando.
- Relay caído: el control local continúa; los comandos remotos quedan rechazados o vencen, nunca se ejecutan tarde.

## Privacidad y seguridad

- Lista cerrada de acciones; no existe ejecución arbitraria.
- Principio de mínimo privilegio por instancia y acción.
- Firmas, TLS, nonces, vencimiento corto y protección contra replay.
- Claves en Keychain y secretos fuera de logs y almacenamiento de extensiones.
- Diagnóstico limitado a códigos técnicos y conteos.
- Sin contenido de chats, historial, URLs identificables ni datos de cuenta.
- Revocación disponible en ControlBot y en el agente local.
- Rate limit para comandos y presencia.

Cualquier ampliación de finalidad o tratamiento de datos exige actualizar `datos.yml` y repetir las puertas de privacidad y seguridad.

## Componentes a modificar

### AutoFactory

- Evolucionar `factory-control-protocol.js` de destino por pestaña a destino por instancia, preservando compatibilidad versionada.
- Integrar autorización y ledger en el runtime real.
- Añadir adaptadores Chrome/Safari para identidad, presencia y aplicación global por instancia.
- Incorporar el cliente seguro del agente local sin ampliar directamente los orígenes web de la extensión.
- Añadir interfaz de emparejamiento, revocación y estado del agente.

### Agente local

- Nuevo componente firmado para macOS con Keychain, mensajería nativa, conexión saliente y actualización controlada.
- Descubrimiento de instancias, router de comandos y agregación de recibos.

### ControlBot

- Registro y presencia de instancias.
- Relay autenticado y almacenamiento de claves públicas/concesiones.
- Tarjetas individuales y control global con estados intermedios y resultados parciales.

## Validación

- Pruebas unitarias de identidad, protocolo v2, firmas, expiración, autorización y ledger.
- Contratos idénticos entre ControlBot, agente y extensiones.
- Integración local Chrome y Safari por separado y simultáneamente.
- Integración remota a través del relay.
- Reinicios de navegador, agente y Mac.
- Comandos duplicados, vencidos, manipulados, revocados y fuera de alcance.
- Pérdida y recuperación de red, recibos y presencia.
- Pausa/reanudación individual y global con fallos parciales.
- Verificación automatizada de ausencia de contenido privado en tráfico y logs.
- Smoke de instalación/carga y rollback a la versión estable anterior.

## Despliegue gradual

1. Protocolo v2 y adaptadores falsos, sin red.
2. Agente local y control en el mismo Mac.
3. Emparejamiento, Keychain y revocación.
4. Relay remoto en entorno de prueba.
5. Auditoría de seguridad, privacidad y puerta legal ControlBot#20.
6. Piloto opt-in con Chrome.
7. Piloto opt-in con Safari.
8. Activación general con rollback documentado.

## Criterios de aceptación

- Chrome y Safari aparecen como instancias independientes.
- Pausar una instancia no afecta otra.
- Todas las pestañas de la instancia seleccionada cambian juntas.
- El control funciona local y remotamente.
- ControlBot nunca declara éxito sin recibo confirmado.
- Reinicios no duplican comandos ni pierden identidad.
- La revocación bloquea órdenes nuevas inmediatamente.
- Ningún tráfico o log contiene conversaciones o identificadores de chat.
- Todas las puertas técnicas, de privacidad, seguridad y legal están verdes antes de producción.
