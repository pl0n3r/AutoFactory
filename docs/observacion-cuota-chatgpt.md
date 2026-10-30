# AutoFactory · observación pasiva de cuota ChatGPT (#431)

## Estado y límites del contrato

**Alcance de este PR: QA y especificación offline**, sin integrar un lector en la extensión Chrome/Safari y sin observar ninguna cuenta real. El ejecutable `tests/test_observacion_cuota.py` lee exclusivamente ficheros HTML **sintéticos guardados en un directorio temporal** y contrasta las señales con el módulo real `factory-control-account-state.js` de este repositorio. No requiere credenciales, red, cookies, sesión ni permisos de extensión. Una captura de fuente de página no constituye por sí sola prueba de un estado de cuenta live.

El observador no intenta medir cuotas mediante mensajes, peticiones, sondas, automatización de login, reintentos o elusión de límites. Lee una instantánea local una vez, deriva únicamente un resultado limitado y descarta el texto. Su salida admite solo `state`, `resetColombia`, `observedColombia`, `retryAllowed=false` y `networkRequests=0`. No serializa contenido de alertas, conversaciones, correos, tokens, URL, cookies ni identificadores de perfil.

## Contrato de observación (un único snapshot, sin sondeo)

1. **Entrada permitida:** documento HTML de fixture guardado por QA, reloj fijo entero en milisegundos UTC. Solo se consideran texto visible de `role="alert"`, `role="status"`, `data-testid="usage-limit-banner"` y enlaces locales `/auth/login` o `/login` con etiqueta «Iniciar sesión», «Sign in» o «Log in».
2. **Límite observado:** una única alerta reconocible de límite de uso (`Has alcanzado el límite`, `Usage limit reached` o equivalente explícito). Se transmite solo ese mensaje al clasificador puro `classifyProviderPageSignal`, el cual valida la hora y devuelve `limit` y un `resetAt` opcional. Una hora ambigua o inexistente **no** genera hora de reinicio.
3. **Sesión cerrada:** enlace explícito de inicio de sesión sin alertas contradictorias ⇒ `requires_login`, `resetColombia=null` y ninguna continuación automática. Señales cruzadas, invisibles, largas o ausentes ⇒ `unknown` (fail-closed), **nunca `ready` por descarte**.
4. **Zona horaria:** el reloj observado y la hora de reinicio se muestran en `America/Bogota` usando 12 horas, `a. m.` / `p. m.`, sin asumir huso de sistema. La fuente debe proporcionar fecha/hora fiable: una frase parcial no autoriza inventar la recuperación ni reintentar.
5. **No efectos externos:** ni `fetch`, ni XHR, ni navegación, ni pairing/bridge, ni solicitudes de cuota, ni interacción con DOM real. `retryAllowed` es siempre falso; `networkRequests` siempre cero. Un `resetAt` observado nunca se interpreta como autorización para reanudar.

## Fixtures y aceptación

| Fixture HTML sintético guardado | Señal observada | Resultado exigido |
| --- | --- | --- |
| `limit.html`, alerta «Has alcanzado el límite ... 1:30 p. m.» | `rate-limit` | `limit`, reinicio `1:30 p. m.`, observada `10:00 a. m.` Colombia |
| `logged-out.html`, enlace local «Iniciar sesión» | `authentication` | `requires_login`, sin reinicio ni reintentos |
| `no-signal.html`, texto de conversación sin alerta | ninguna | `unknown`, no presumir `ready` |
| HTML con elementos ocultos, scripts, varias alertas o señales contradictorias | inconsistente | `unknown`, no acciones |
| Alerta con dos posibles horas o sin hora | `rate-limit` ambiguo | `limit`, sin hora inventada |

**AC-01:** `python3 -m unittest -v tests.test_observacion_cuota.ObservacionCuotaTests.test_criterio_principal`; **regresión completa:** `python3 -m unittest -v tests.test_observacion_cuota`. **AC-02:** `Validate / Pruebas y smoke Chrome` success sobre HEAD exacto. Además comprobar checks SonarCloud, CodeQL, coordinación V3 y revisión CodeRabbit únicamente cuando el PR ya es final y el CI está verde. El check de CI no equivale a ejecución del smoke Safari ni a una observación live.

## Prerrequisitos para integración real fuera de este PR

Se requiere contrato de integración con claims sobre archivos de runtime, un origen de señales visible específico validado sin texto de chats, decisión del propietario para fase live y revisión de privacidad/seguridad. Nada de ello se concede mediante este PR. La decisión D-061 prohíbe activar pairing o tráfico real del puente; no debe ampliarse el manifiesto ni registrarse PII. Reversión: el squash que agrega esta especificación y su fixture offline puede revertirse sin alterar la extensión instalada.
