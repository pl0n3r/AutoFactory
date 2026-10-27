# Operación y soporte local de AutoFactory (#261)

**Alcance:** runbook de preparación offline, fase construccion. AutoFactory es una extensión local/manual Chrome/Safari, no un backend con /health, ni una central de alertas 24/7. Este documento no instala monitores, activa redes, conecta ControlBot, recoge chats ni cambia el runtime. Fuentes verificadas: AGENTES.md, decisiones.yml (D-060, D-061, D-062), datos.yml, local-tab-progress.js, docs/LOCAL-TAB-PROGRESS.md, docs/LOCAL-PROGRESS-PRESENTATION.md, tests/test_tab_health_status.py.

## Señales locales y límites de observación

| Señal | Evidencia técnica admisible | Interpretación |
| --- | --- | --- |
| ACTIVA | El clasificador offline observa actividad reciente o huella técnica que cambió | No demuestra sesión disponible, navegación real ni producción VERDE |
| SIN_AVANCE (SIN AVANCE en UI) | Huella opaca estable y umbral cumplido tanto desde la última actividad como desde la estabilidad de huella | Revisar manualmente esa pestaña, sin reenviar |
| UNKNOWN | Tiempo o huella inválidos, fuente desconectada o estado contradictorio | Fail-closed: no inferir salud ni recuperación |
| Salud local de pestaña | account-budget-background.js registra eventos send/reply, estado pausado/rate-limit y estancamiento | Log limitado a 200 eventos; nunca contenido de chat |
| Diagnóstico general | datos.yml inventaría eventos de diagnóstico local | Colección distinta: máximo 300 eventos y 7 días al agregar |

**Importante:** local-tab-progress.js solo implementa una clasificación offline. La tarjeta de progreso del popup (#250) inicia UNKNOWN sin proveedor conectado y se ha verificado con fixtures. No es un monitor real de Chrome/Safari ni un servicio de observación remota. No confundir SIN_AVANCE, un error de red o un navegador cerrado con una caída global de ChatGPT.

## Matriz de severidad y escalamiento

| Severidad | Incidente verificable | Contención y responsable |
| --- | --- | --- |
| SEV-1 seguridad/privacidad | Exposición sospechada de token, credencial, dato de chat, acceso o permiso indebido | PARADA manual inmediata de la pestaña; avisar al dueño y seguridad/privacidad por canal autorizado; nunca adjuntar material sensible |
| SEV-2 interrupción confirmada | SIN_AVANCE con umbral validado, crash del navegador o falla de carga reproducible | Pausar la automatización local; responsable de soporte humano revisa y documenta de forma saneada |
| SEV-3 degradación/indeterminación | UNKNOWN, señal parcial, sesión expirada, cuota/rate limit | Fail-closed; suspender recuperación automática y derivar a la siguiente ventana atendida |
| SEV-4 informativa | ACTIVA con evidencia técnica local, sin incidencia | Ninguna alerta externa ni ticket automático; no convertir la señal en HEALTH productivo |

Estas severidades solo priorizan la actuación humana cuando hay cobertura. Ninguna promete SLA, asistencia inmediata o respuesta fuera de horario.

## Triage manual: identificar, diagnosticar y PARADA

1. Identificar solo el navegador (Chrome/Safari), versión local, timestamp aproximado, código de estado ACTIVA/SIN_AVANCE/UNKNOWN e ID de pestaña efímero local. No capturar dirección, título o ID de conversación.
2. Validar umbral, tiempos y huellas opacas del clasificador. Si falta fuente válida, permanecer en UNKNOWN; nunca interpretar el popup de fixtures como fuente en vivo.
3. Clasificar el escenario: navegador cerrado o crash; extensión no cargada; ChatGPT inaccesible/no carga conversación; sesión expirada; cuota/rate limit; SIN_AVANCE confirmado. Separar red local, navegador y ChatGPT, porque son fallos distintos.
4. Ordenar PARADA: deshabilitar la continuación automática de esa pestaña y no reenviar mensajes mientras el resultado anterior sea incierto. No automatizar CAPTCHA, MFA, inicio de sesión, compras, permisos, aprobaciones o límites de uso.
5. Diagnosticar con campos acotados: nombre de browser, versión, código de error, timestamp redondeado, contadores, estado y hash/huella técnica opaca si se requiere. No inspeccionar ni copiar conversaciones para justificar el ticket.
6. Escalar un incidente persistente con Issue saneado: severidad, pasos genéricos, ambiente, código de error, esperado vs observado, SHA/test. No subir logs brutos, pantallazos ni adjuntos sin aprobación y sanitización.

## Recuperación manual y parada segura por escenario

- **Navegador cerrado / extensión descargada:** mantener PAUSADO; abrir el navegador y comprobar manualmente la extensión y pestaña antes de reanudar. Safari real sigue pendiente de smoke #122.
- **ChatGPT no responde / conversación no carga:** no reenviar por incertidumbre. Comprobar manualmente si el envío original se procesó; si no se sabe, continuar en UNKNOWN y PARADA.
- **Sesión expirada o autenticación:** pedir intervención directa al usuario. Nunca sortear CAPTCHA, MFA, controles de permisos ni iniciar sesión por el operador automático.
- **Cuota o rate limit:** detener envíos y respetar la ventana del proveedor; prohibido rotar cuentas o cambiar modalidad para eludir restricciones.
- **SIN_AVANCE confirmado:** revisar estado de la pestaña y ausencia de respuesta; una recarga es opción humana únicamente tras evaluar pérdida de trabajo y riesgo de duplicados.
- **Recuperación validada:** antes de habilitar manualmente confirmar pestaña correcta, ninguna entrega pendiente, estado local consistente y consentimiento del operador. Si sigue UNKNOWN, permanecer parado. Registrar solo resultado técnico minimizado.

No borrar storage, reinstalar extensiones, resetear perfiles ni revertir versiones por defecto. Para rollback de versión rige #262, preservando artefacto anterior y sin presumir smoke Chrome/Safari real.

## Privacidad: lista positiva y lista prohibida (D-062)

**Lista positiva** permitida para un diagnóstico mínimo: timestamp aproximado, navegador y versión, código de error enumerado, ACTIVA/SIN_AVANCE/UNKNOWN, contadores, ID de pestaña solo local y efímero, y hash/huella opaca técnica cuando sea imprescindible. Compartir únicamente un resumen manual saneado y proporcional.

**PROHIBIDO:** volcado de PII o datos personales, texto de chat, prompts, respuestas, nombres, correos, teléfonos, URL/ID de conversación, ruta de chat, contraseñas, tokens, cookies, secretos, llaves, credenciales, body HTTP, DOM o HTML completo, capturas de pantalla y exportación bruta de logs/storage. No pegar contenido sensible en GitHub, ChatGPT ni servicios externos. Cuando no sea posible sanear, no compartir y escalar por canal privado autorizado. Esta prohibición se aplica también a ejemplos, fixtures y reportes post-incidente.

El log de salud de pestaña (200 eventos) y el diagnóstico general (300 eventos / 7 días al agregar) son colecciones distintas; esos topes no dan permiso de exportar, ampliar retención o transmitir remotamente.

## Ventanas, notificaciones y revisión diaria

- **Ventana de soporte humano:** solo cuando el dueño o persona autorizada confirma que atiende; si no hay responsable, marcar SIN COBERTURA. No existe guardia 24/7, SLA de respuesta, tarea programada ni supervisión continua.
- **Aviso permitido:** lectura voluntaria del estado local existente. El popup #250 presenta un estado sintético sin fuente de progreso integrada; no constituye alarma conectada.
- **Alertas externas NO DESPLEGADAS:** correo, SMS, push, webhooks, ControlBot remoto y escalamiento automático no funcionan por este runbook. Límite: **cero notificaciones externas automáticas**, sin texto de chat en alertas. Una función futura requiere consentimiento y D-061, decisión #242/B sustituida legítimamente, ControlBot#20, reglas antirruido y pruebas reales.
- **Límite antirruido:** un incidente por causa/pestaña durante revisión manual; sin reavisos por cada ciclo, no llamar recuperado a UNKNOWN, sin paginación continua fuera de horario.
- **Chequeo diario manual solo con cobertura:** verificar navegador y pestañas habilitadas; revisar señales, pausas y límites; priorizar SEV-1/SEV-2; comprobar envíos inciertos antes de reanudar; registrar Issue saneado y cierre con evidencia. Si no hay operador, NO ejecutar check-in en segundo plano.

## Cierre de incidente y frontera de producción

Cerrar solo al documentar causa, contención, recuperación humana, observación local repetible y evidencia sin PII; sin esa evidencia registrar UNKNOWN/no validado. Puertas pendientes que este trabajo no resuelve: SonarCloud #219, Safari real #122, consentimiento #242/B y ControlBot#20, lanzamiento/rollback #262. Los tests documentales y el CI no prueban instalación, alertas remotas, seguimiento 24/7, producción VERDE ni go-live.

Prueba focal offline: python3 -m unittest -v tests.test_operacion_soporte. Reversión: revertir documento y prueba; sin cambios de runtime, permisos, red ni datos reales.
