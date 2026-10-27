# Recuperación local offline de preferencias (AutoFactory #260)

**Estado: CONTRATO DE DISEÑO Y PRUEBA SINTÉTICA. NO ACREDITA RECUPERACIÓN REAL.**

No existe en este cambio un exportador/importador instalado ni integración con Chrome/Safari.

## Alcance y puertas de autorización

Solo preferencias locales no sensibles en perfiles sintéticos. No hay intervención en perfiles de usuarios, instalaciones, permisos, archivos, red, ControlBot ni pairing. No hay backup operativo, deploy, publicación ni go-live. D-060, D-061 y D-062 siguen vigentes. Antes de intervenir un perfil real se requieren autorización humana, revisión de privacidad, seguridad, consentimiento, backup verificable y smoke Chrome/Safari instalado. El test offline nunca concede estas autorizaciones.

## Lista positiva cerrada: allowlist v1

El objeto preferences contiene **exactamente** estas cuatro claves obligatorias:

| Campo | Tipo estricto | Valores |
| --- | --- | --- |
| language | cadena | es / en |
| theme | cadena | system / light / dark |
| localProgressEnabled | booleano | true / false |
| idleWarningSeconds | entero, no booleano | 30–3600 |

Son campos propuestos para la prueba, no nombres confirmados de almacenamiento real Chrome/Safari. No se permiten campos extra, valores libres, arrays, objetos anidados ni URLs.

## Lista negativa absoluta: denylist

Nunca transferir chats, mensajes, prompts, texto de conversaciones, credenciales, passwords, cookies, tokens, claves, secretos, emails, alias, PII ni datos de terceros. Tampoco URLs ni IDs de conversación, tab IDs, rutas o hashes de chats; pairing, autorización, credenciales o grants ControlBot; receipt ledger, recibos de órdenes, ACK, cursores, colas, comandos, estados de sesión, estados de cuenta, eventos, diagnósticos o estados remotos. Prohibido copiar almacenamiento privado de perfiles y logs.

La exportación del fixture proyecta solo las cuatro claves permitidas. Los demás valores de la fuente se ignoran y no se serializan.

## Envelope y verificación

Formato exacto: kind = autofactory-local-preferences; version = 1; preferences = objeto validado; sha256 = 64 caracteres hexadecimales minúsculos. SHA-256 se calcula sobre JSON canónico del envelope sin sha256, usando orden de claves, ASCII y separadores compactos. El hash detecta corrupción accidental, **no prueba autenticidad, consentimiento ni confidencialidad**: un tercero puede recalcularlo. Rechazar valores inválidos, estructura extra, campos faltantes, hash diferente y tipos incorrectos antes de preparar destino.

## Restauración reversible del fixture

1. Crear origen sintético y destino descartable en memoria. No leer chrome.storage, Safari ni perfiles de navegador reales.
2. Exportar solo campos positivos y comprobar tipo/valores; jamás serializar campos ajenos, credenciales ni texto.
3. Validar todo el snapshot importado de forma fail-closed y guardar la copia anterior del destino.
4. Si una clave permitida ya existe con distinto tipo o valor, rechazar la restauración completa. No sobrescribir ni modificar parcialmente.
5. Crear copia del destino, restaurar en esa copia, conservar otras claves preexistentes y verificar que aplicar dos veces es idempotente, sin cambios adicionales.
6. Para rollback, desechar la copia restaurada y recuperar el estado previo. Nunca escribir en almacenamiento real.
7. Ejecutar: python3 -m unittest -v tests.test_local_recovery_contract.

## Evidencia y limitaciones

Los tests unitarios solo prueban las reglas sintéticas en memoria; **NO ACREDITA RECUPERACIÓN REAL** de Chrome ni Safari, ni restauración en perfiles/dispositivos reales. CI en verde sin ejecutar explícitamente esta suite tampoco acredita sus AC. QA/seguridad deben verificar AC-01, AC-02 y AC-03 sobre el HEAD exacto. Siguen pendientes smoke de instalación, autoridad humana, puerta legal, backups reales, validación de privacidad, release reversible y decisiones de producción. Revertir el futuro squash retira el documento y test sin afectar perfiles ni archivos reales.
