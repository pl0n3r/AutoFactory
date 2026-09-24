# ChatGPT Autopilot Local — Chrome y Safari

Extensión local que supervisa chats de desarrollo y usa el DOM de ChatGPT. No usa capturas, coordenadas, posición de ventanas ni `pyautogui`.

Su función es mantener trabajando cada pestaña habilitada: espera mientras ChatGPT responde, verifica que aparezca una respuesta, envía la continuación al terminar y recupera errores mediante **Reintentar** o **Continuar generando**. No pulsa aprobaciones, permisos, compras, selectores de modelo ni acciones destructivas.

Opera en todas las pestañas de ChatGPT habilitadas, incluso cuando están detrás de otra ventana. Un heartbeat del proceso de fondo reactiva la supervisión periódica; el scroll visual solo se mueve en la pestaña visible.

## Versión 1.6.1

- Respeta mensajes personalizados de cualquier longitud. Solo restaura la plantilla predeterminada cuando el campo está vacío o pertenece a un esquema antiguo.

- Sigue el final del chat en todos sus contenedores desplazables y espera a que deje de crecer.
- Expone velocidad, estabilidad, pausa manual y duración máxima del desplazamiento.
- Permite activar la recarga automática y definir el intervalo mínimo entre recargas bloqueadas.
- Detecta en español e inglés la alerta de duración máxima, abre un chat nuevo y continúa allí.
- Amplía el aprendizaje local con medias, percentiles, errores y recuperaciones exitosas.
- Reinicia la ventana de inicialización al activar el piloto y evita recargas prematuras mientras ChatGPT monta el compositor.
- Permite conservar el nivel de razonamiento actual o exigir Alto/High antes de cada continuación.
- Reconoce los compositores textarea y contenteditable actuales; un chat nuevo en `/` espera su interfaz sin entrar en un ciclo de recargas.
- Reconoce los controles de envío actuales, espera a que React los habilite y registra metadatos seguros si no aparecen.
- Reconoce `Stop`/`Detener` como generación activa, no escribe mientras ChatGPT trabaja y retira solo su propio borrador exacto si hubo una carrera.
- Busca y confirma Alto/High con controles compatibles con Chrome y Safari. Si una interfaz no expone el selector, conserva el nivel actual y continúa sin bloquear ni saturar el registro.
- Reduce el trabajo acumulado en chats largos: evita el ciclo causado por su propio indicador, agrupa mutaciones del streaming, reutiliza la configuración y recorre el texto de errores sin crear grandes colecciones temporales.
- Ejecuta mantenimiento periódico, libera observadores y temporizadores al abandonar la página y conserva como máximo 300 eventos de diagnóstico de los últimos siete días.
- Mantiene PLAY verde y STOP rojo visibles en una barra fija del popup, con un indicador de estado de alto contraste.
- Reconoce su propio prompt cuando quedó escrito tras un envío interrumpido y retoma el envío; continúa protegiendo cualquier texto diferente escrito por el usuario.
- Añade un selector Chat/Work en el popup, usa Chat de forma predeterminada y aplica el modo elegido mediante el control real de ChatGPT antes de continuar.
- Detecta comprobaciones adicionales de seguridad en español e inglés y espera sin cancelar, reenviar, recargar ni cambiar automáticamente de modelo.
- Limita esa detección a la respuesta más reciente para que un aviso histórico no bloquee ciclos posteriores.
- Ofrece refresh periódico opcional, con intervalo de 5 minutos a 24 horas, y solo recarga cuando no existe una respuesta, envío o borrador pendiente.

## Memoria adaptativa local

Acumula hasta 50 muestras recientes de tiempos de inicio y respuesta, además de ciclos, recuperaciones y fallos. Con esas muestras ajusta el umbral que distingue una respuesta lenta de un flujo bloqueado. La memoria se comparte entre los chats habilitados, permanece en el navegador y no guarda el texto de las conversaciones.

Cuando ChatGPT indica que la conexión fue interrumpida, el piloto espera hasta dos minutos para permitir la reconexión. Si la generación continúa bloqueada, solicita una sola cancelación, espera otros 30 segundos y solo entonces permite una recarga controlada. El siguiente mensaje vuelve a inspeccionar el estado real antes de actuar para reducir el riesgo de duplicar trabajo.

El seguimiento visual usa desplazamiento progresivo sobre todos los contenedores relevantes del chat. Avanza en pasos configurables, continúa cuando aumenta la altura del contenido y se detiene después del número configurado de comprobaciones estables. Un desplazamiento manual aplica la pausa configurada.

También mantiene un historial agregado de errores por tipo y acciones que terminaron en un ciclo exitoso. La política actual distingue conexión, límite temporal, interfaz incompleta, sesión cerrada y respuesta recuperable. Solo automatiza esperas, recarga controlada, **Reintentar** y **Continuar generando**; una autenticación o autorización queda marcada para intervención humana.

## Log de diagnóstico

El service worker conserva hasta 300 eventos de los últimos siete días: fecha, pestaña/ventana, ruta del chat, estado, tipo de error, acción y resultado. No guarda mensajes ni contenido del chat. **COPIAR LOG** produce un JSON listo para compartir; **BORRAR LOG** elimina el historial local.

## Instalar en Chrome

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida**.
4. Selecciona la carpeta raíz que clonaste.
5. Recarga las pestañas de ChatGPT que ya estaban abiertas.

## Instalar en Safari

1. Clona el repositorio en macOS con Xcode instalado.
2. Ejecuta `./build-safari.sh` desde la raíz.
3. Abre `safari/ChatGPT Autopilot Local.xcodeproj`.
4. En Xcode, selecciona tu equipo de firma si macOS lo solicita y pulsa **Run**.
5. Abre Safari > Ajustes > Extensiones, activa **ChatGPT Autopilot Local**, permite acceso a `chatgpt.com` y recarga las pestañas abiertas.

Chrome y Safari comparten el mismo núcleo y los mismos selectores DOM. `build-safari.sh` sincroniza la fuente web con el contenedor nativo antes de compilar.

## Usar

Pulsa **ACTIVAR TODAS** una vez. Todas las pestañas de ChatGPT heredan el estado global y trabajan de forma independiente. El indicador inferior muestra el estado de cada chat. **PAUSAR TODAS** detiene el piloto global.

La extensión escribe en `#prompt-textarea`, vuelve a leer el mensaje exacto y solo pulsa el botón real `#composer-submit-button` / `data-testid="send-button"`. Si no encuentra esos elementos, no envía nada.

Antes de cada envío exige seis lecturas consecutivas e idénticas del campo durante 900 ms. Una configuración antigua o un mensaje vacío se reemplaza por la plantilla completa. Si React/ChatGPT altera el texto durante ese intervalo, limpia el campo y cancela el envío.

## Confiabilidad de envío

Cada envío se considera exitoso únicamente cuando el campo queda vacío y el texto exacto aparece como un nuevo mensaje del usuario. La pestaña conserva el envío pendiente tras una recarga, evita duplicarlo y aplica espera exponencial ante fallos. Después de cinco fallos o tres recargas en diez minutos abre un circuito temporal de protección.
