# Historial de versiones

Este archivo conserva la evolución funcional de ChatGPT Autopilot Local durante su desarrollo. Las versiones anteriores a la adopción de Git se reconstruyeron a partir de los diagnósticos exportados, las compilaciones locales y las decisiones registradas durante las pruebas. El repositorio contiene el código fuente completo de la versión vigente; no se fabricaron snapshots históricos que ya no existían en disco.

## 1.6.29 — 2026-10-10

- Simplifica la recuperación a un Retry, una recarga y un único chat nuevo.
- Reduce las pausas entre pasos de 10 a 4 segundos y elimina la espera adicional de un minuto.
- Migra el runtime y descarta estados lentos heredados para evitar bloqueos persistentes.

## 1.6.28 — 2026-10-10

- Ignora botones Retry residuales cuando el chat nuevo ya cargó su compositor.
- Limpia la recuperación anterior y permite continuar en el único chat nuevo sin esperas falsas.

## 1.6.27 — 2026-10-10

- Migra y limita a un minuto los temporizadores de cinco minutos conservados por versiones anteriores.
- Muestra en rojo la recarga controlada de una conversación no disponible.

## 1.6.26 — 2026-10-10

- Permite abrir un único chat de recuperación cuando Retry, recarga y espera de un minuto no resuelven una conversación inaccesible.
- Persiste el bloqueo antes de navegar para impedir aperturas repetidas o chats en cadena.

## 1.6.25 — 2026-10-10

- Reduce de cinco minutos a un minuto la pausa de recuperación de conversaciones inaccesibles.
- Muestra en rojo la verificación de recuperación para evitar estados verdes engañosos.

## 1.6.24 — 2026-10-10

- Nunca pulsa Retry ni transfiere la conversación mientras existe una respuesta real activa.
- Sustituye la espera permanente de conversaciones inaccesibles por una pausa de cinco minutos y un nuevo ciclo automático de recuperación.
- Evita contabilizar repetidamente el mismo estado de espera y mantiene el chat actual durante toda la recuperación.

## 1.6.23 — 2026-10-10

- Aplaza el refresh periódico mientras ChatGPT mantiene una generación real activa.
- Recarga inmediatamente al terminar la respuesta, aunque quede estado interno pendiente.
- Los fallos de carga agotados permanecen en el chat actual y nunca escalan automáticamente a un chat nuevo.

## 1.6.22 — 2026-10-09

- Limita a una sola acción cada transición automática hacia un chat nuevo.
- Conserva por pestaña durante 10 minutos el bloqueo contra transferencias duplicadas, incluso tras navegar.

## 1.6.21 — 2026-10-09

- Añade selección configurable de GPT-6, GPT-5.6 Sol o modelo actual.
- Usa GPT-6 como valor predeterminado y verifica el modelo antes de aplicar High y enviar.
- Mantiene paridad funcional entre Chrome y Safari.

## 1.6.20 — 2026-10-05

- Ejecuta el refresh periódico al vencer aunque ChatGPT continúe respondiendo.
- Conserva el estado de espera y no pulsa Stop antes de recargar.
- La recarga permite revelar antes errores o estados bloqueados de la conversación.

## 1.6.19 — 2026-10-05

- Conserva el reloj de recarga periódica ante órdenes repetidas de activación.
- Evita que ControlBot o múltiples controles pospongan indefinidamente el refresh configurado.

## 1.6.18 — 2026-10-04

- Ignora controles Stop ocultos y controles propios de AutoFactory al detectar generación activa.
- Impide transferir a un chat nuevo mientras ChatGPT continúa respondiendo.

## 1.6.17 — 2026-10-04

- Distingue el botón global de chat nuevo del botón incluido en la alerta real de duración máxima.
- Impide nuevas transferencias cuando la pestaña ya se encuentra en la ruta de chat nuevo.
- Evita que varias pestañas creen chats paralelos por falsos positivos.

## 1.6.16 — 2026-10-03

- Limpia inmediatamente la protección si aparece una generación o respuesta posterior al envío ambiguo.
- Reconcilia respuestas confirmadas tarde sin duplicar el mensaje ni esperar cinco minutos.
- Mantiene la misma recuperación en Chrome y Safari.
- Hace que el build de Safari derive su lista de archivos del mismo contrato que valida manifest, popup y service worker.
- Sincroniza automáticamente los nuevos módulos Factory Control y cualquier asset local declarado en el futuro.
- Ejecuta el preflight de paridad Chrome/Safari antes de invocar Xcode, sin ampliar permisos ni activar el bridge.

## 1.6.15 — 2026-10-02

- Reconoce como propio el borrador que ChatGPT normaliza visualmente con otros espacios o saltos.
- Retoma ese borrador sin reescribirlo ni provocar otro render del compositor.
- Sigue pausando ante cualquier contenido realmente diferente del usuario.

## 1.6.14 — 2026-10-02

- Recupera el botón de envío vivo justo antes del clic para evitar referencias reemplazadas por React.
- Activa la protección durante cinco minutos ante un envío ambiguo, evitando reintentos y duplicados.
- Mantiene el mismo comportamiento seguro en Chrome y Safari.

## 1.6.13 — 2026-10-02

- Restaura una sola vez el mensaje cuando React sustituye el compositor por uno vacío antes del envío.
- Conserva cualquier texto diferente introducido por el usuario y cancela el envío en ese caso.
- Mantiene la protección contra duplicados y la misma recuperación en Chrome y Safari.

## 1.6.12 — 2026-10-02

- Evita falsos bloqueos cuando React reconstruye transitoriamente el compositor después de escribir.
- Conserva la validación exacta del mensaje inmediatamente antes del envío.
- Mantiene protección contra mensajes modificados y duplicados en Chrome y Safari.

## 1.6.11 — 2026-10-01

- Desactiva por defecto el presupuesto compartido de mensajes.
- Evita cualquier pausa presupuestaria mientras la opción esté apagada.
- Añade un interruptor explícito en el popup para activarlo voluntariamente.

## 1.6.10 — 2026-10-01

- Actualiza cada segundo el estado de espera del presupuesto compartido.
- Refleja extensiones de espera causadas por otras pestañas sin aparentar un bloqueo.
- Continúa automáticamente cuando el turno compartido queda disponible.

## 1.6.9 — 2026-10-01

- Detiene inmediatamente la generación cuando ChatGPT informa una conexión interrumpida.
- Espera hasta 30 segundos después de Stop y recarga únicamente si el bloqueo persiste.
- Mantiene la misma política de recuperación en Chrome y Safari.

## 1.6.8 — 2026-09-29

- Evita el ciclo infinito cuando ChatGPT no puede cargar una conversación.
- Ejecuta dos reintentos, una recarga controlada y, si el error persiste, continúa en un chat nuevo.
- Da prioridad a esta recuperación segura aunque el circuito de fallos esté activo.
- Mantiene paridad funcional entre Chrome y Safari y añade pruebas de la escalada.

## 1.6.7 — 2026-09-26

- Evita falsos errores de envío cuando ChatGPT virtualiza el mensaje en conversaciones largas.
- Confirma el envío si el compositor queda vacío y aparece el mensaje exacto o comienza la generación real.
- Conserva la protección contra mensajes duplicados y añade una prueba de regresión.

## 1.6.6 — 2026-09-26

- Soporta el nuevo selector de esfuerzo de ChatGPT basado en slider.
- Lleva Media/Medium a Alta/High mediante el control de teclado real y verifica el nivel máximo.
- Añade pruebas para el texto compuesto, el objetivo del slider y su control interactivo.

## 1.6.5 — 2026-09-26

- Reconoce Medium/Media/Medio y Low/Baja/Bajo como estados válidos del selector de razonamiento.
- Permite cambiar de Medium a High sin confundir el control con el selector general del modelo.
- Añade una prueba de regresión para los niveles localizados.

## 1.6.4 — 2026-09-25

- Activa por defecto la recarga periódica cada 15 minutos y fija en un minuto el cooldown de recuperación.
- Migra una vez las instalaciones existentes a los nuevos valores predeterminados.
- Añade al indicador de página ciclos, recuperaciones, errores, uptime y cuenta regresiva de refresh.

## 1.6.3 — 2026-09-25

- Separa el control de razonamiento del selector general del modelo.
- Verifica Alto/High de forma explícita y usa Thinking/Pensando como paso intermedio cuando la interfaz lo exige.
- Evita registrar un cambio exitoso si solo se abrió el selector equivocado.

## 1.6.2 — 2026-09-25

- Sustituye rutas con identificador de conversación por `/c/:id` en el log local.
- Restringe detalles de diagnóstico a metadatos técnicos permitidos y anonimiza entradas anteriores en la exportación.
- Refuerza pruebas contra filtración de rutas, tokens, mensajes de excepción y datos anidados, tanto para Chrome como para Safari.

## 1.6.1 — 2026-09-23

- Corrige la sustitución accidental de mensajes personalizados cortos por la plantilla predeterminada.
- Acepta cualquier mensaje no vacío y conserva la protección frente a configuraciones antiguas.
- Añade una prueba de regresión específica para el mensaje configurable.
- Sincroniza y valida la misma implementación en Chrome y Safari.

## 1.6.0 — 2026-09-23

- Consolida el modo estable para Chrome y Safari.
- Añade selector **Chat / Work**, con Chat como valor inicial.
- Añade refresh periódico opcional y configurable, ejecutado solo cuando el chat está inactivo y el compositor está vacío.
- Espera de forma segura las comprobaciones adicionales de ChatGPT sin cancelar, recargar, reenviar ni cambiar de modelo.
- Limita la detección de avisos a la respuesta más reciente para que mensajes históricos no bloqueen el flujo.
- Mejora rendimiento y memoria en conversaciones largas mediante caché de configuración, agrupación de mutaciones y limpieza de observadores y temporizadores.
- Hace visibles los controles PLAY y STOP tanto en el popup como en el indicador de la página.
- Conserva como máximo 300 eventos de diagnóstico durante siete días.

## 1.4.3 — 2026-09-23

- Refina la espera mientras ChatGPT está pensando para impedir escrituras y reintentos simultáneos.
- Reduce falsos positivos cuando el botón de enviar cambia temporalmente durante una respuesta.
- Mejora la estabilidad del ciclo en sesiones prolongadas.

## 1.4.2 — 2026-09-23

- Reconoce los controles compactos **Stop / Detener** como señal de generación activa.
- Evita escribir mientras el modelo responde.
- Retira únicamente el borrador exacto propiedad del piloto si ocurre una carrera con el inicio de una respuesta.

## 1.4.1 — 2026-09-23

- Amplía la detección del compositor para interfaces `textarea` y `contenteditable`.
- Reconoce controles de envío modernos y espera a que React los habilite.
- Evita recargas prematuras mientras un chat nuevo termina de montar su interfaz.

## 1.4.0 — 2026-09-23

- Rediseña el popup como panel de control con parámetros configurables.
- Añade selección del nivel de razonamiento, incluido **Alto / High**.
- Amplía el aprendizaje local con ciclos, fallos, recuperaciones, medias y percentiles.
- Añade recarga ante bloqueo con cooldown configurable.
- Introduce estado persistente por pestaña y supervisión de pestañas en segundo plano.

## 1.2.2 — 2026-09-23

- Detecta en español e inglés el límite de duración de una conversación.
- Abre un chat nuevo y continúa automáticamente cuando ChatGPT exige migrar la conversación.
- Mejora el desplazamiento progresivo y espera a que el contenido deje de crecer.

## 1.2.0 — 2026-09-23

- Añade diagnóstico exportable y clasificación local de errores.
- Incorpora recuperación de conexiones interrumpidas, backoff y circuit breaker.
- Añade el botón STOP dentro de la página para detener el piloto sin abrir el popup.
- Confirma cada envío comprobando que el mensaje exacto aparezca en la conversación.

## 1.1.2 — 2026-09-22

- Sustituye la automatización por coordenadas por interacción con el DOM real de ChatGPT.
- Añade soporte inicial para Chrome y la extensión web de Safari.
- Introduce scroll automático, estado visible y controles globales de activación y pausa.

## 1.0.0 — 2026-09-22

- Primer prototipo local del piloto automático.
- Inserta un mensaje de continuación y utiliza el control real de envío.
- Supervisa una conversación y espera a que ChatGPT termine antes de continuar.

## Política desde 1.6.1

- Cada cambio publicable se registra aquí.
- Cada versión se identifica en `manifest.json`, `package.json`, el popup y el evento `content-loaded`.
- Las versiones publicadas en GitHub reciben una etiqueta `vX.Y.Z`.
- Chrome y Safari deben compartir el mismo código web y pasar `npm test` antes de etiquetarse.
