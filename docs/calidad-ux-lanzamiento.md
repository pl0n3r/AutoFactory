# Calidad UX y rendimiento offline — AutoFactory #264

**Corte:** 27-oct-2026, roadmap [#1](https://github.com/pl0n3r/AutoFactory/issues/1), fuente [#258](https://github.com/pl0n3r/AutoFactory/issues/258). **NO es certificación de UX real ni `GREEN` de producción.** AutoFactory permanece en `construccion`. D-061 y #242/B prohíben pairing y tráfico real ControlBot.

## Método reproducible

Con checkout de SHA exacto ejecutar `python3 -m unittest -v tests.test_calidad_ux_lanzamiento`. Inspeccionar `popup.html`, `popup.js`, `background.js`, `background-entry.js` y sus copias bajo `safari/ChatGPT Autopilot Local Extension/Resources/`: bytes UTF-8, paridad, etiquetas, nombres de controles, CSS foco y contraste en colores sólidos. **No** instala un navegador ni mide rendering, gradientes o zoom 200 %.

El modelo **SINTÉTICO** calcula p95 nearest-rank de 20 muestras fijas, presupuesto CPU/ciclo 20 ms, memoria pico 24 MiB e historial 200 eventos; esos valores son **NO tiempo real**, **NO perfil CPU**, **NO heap físico** y **NO prueba real de arranque frío**. Pruebas negativas alteran CSS, labels, bytes, latencia, memoria e historial y exigen fallo.

Para pasar los estados **PENDIENTE_REAL** deben observarse Chrome MV3 instalado, Safari/Xcode firmado y habilitado según #122, Tab/Shift+Tab, VoiceOver, 200 % zoom en ancho 320 px, contrastes dinámicos y recursos con profiler de ambos navegadores; capturar solo métricas agregadas, nunca contenido de chats/tokens.

## Matriz por plataforma

| ID | Plataforma | Requisito | Umbral | Estado | Evidencia |
| --- | --- | --- | --- | --- | --- |
| AX-01 | Chrome/Safari | Teclado | PLAY/STOP button con orden DOM | OFFLINE | popup.html |
| AX-02 | Chrome/Safari | Foco | :focus-visible en PLAY/STOP y :focus en inputs | OFFLINE | CSS y negativos |
| AX-03 | Chrome/Safari | Nombres/roles | label for en prompt/delay/model-target/reasoning-level y role=status | OFFLINE | HTML semántico |
| AX-04 | Chrome/Safari | Contraste | sRGB WCAG AA >=4.5:1 texto y muted sobre panel | OFFLINE | variables sólidas |
| AX-05 | Chrome/Safari | Zoom 200 % | reflow real 320 px y sin scroll horizontal | PENDIENTE_REAL | sin navegador instalado |
| AX-06 | Chrome/Safari | Tecnología asistiva | VoiceOver/NVDA, lectura de nombre y estado | PENDIENTE_REAL | requiere prueba real |
| PF-01 | Chrome/Safari | Popup HTML bytes | <= 16384 bytes UTF-8 | OFFLINE | inspección bytes |
| PF-02 | Chrome/Safari | Popup JS bytes | <= 40960 bytes UTF-8 | OFFLINE | inspección bytes |
| PF-03 | Chrome/Safari | Background bytes | <= 32768 bytes UTF-8 | OFFLINE | inspección bytes |
| PF-04 | Chrome/Safari | Background entry bytes | <= 2048 bytes UTF-8 | OFFLINE | inspección bytes |
| PF-05 | Fixture | Arranque sintético p95 | <= 200 ms; 20 muestras | SINTÉTICO | NO tiempo real |
| PF-06 | Fixture | CPU sintética | <= 20 ms por ciclo modelado | SINTÉTICO | NO perfil CPU |
| PF-07 | Fixture | Memoria sintética | <= 24 MiB modelo | SINTÉTICO | NO heap físico |
| PF-08 | Fixture | Historial sintético | <= 200 eventos | SINTÉTICO | sin chats |
| PV-01 | Chrome/Safari | Paridad | cuatro archivos idénticos byte a byte | OFFLINE | espejo Safari |
| RL-01 | Chrome | UX instalado | teclado + zoom 200 %, 20 arranques fríos | PENDIENTE_REAL | requiere Chrome cargado |
| RL-02 | Safari | Safari real | #122: Xcode firmado y Safari cargado, VoiceOver | PENDIENTE_REAL | build unsigned insuficiente |
| RL-03 | Chrome/Safari | Recursos reales | CPU/memoria/arranque p95 con profiler, 5 minutos | PENDIENTE_REAL | no medido |
| RL-04 | ControlBot | Pairing real | D-061 y #242/B impiden tráfico y uso real | BLOQUEADO_LEGAL | no habilitado |

## Deuda y reversión

Los tests estáticos no acreditan foco dinámico ni interacción real, estados con gradientes ni compatibilidad de reflow/zoom. Conservar `UNKNOWN` hasta prueba física de cada navegador y su extensión, en particular Safari GUI [#122](https://github.com/pl0n3r/AutoFactory/issues/122). El puente con ControlBot permanece bloqueado por D-061/#242/B; esta hoja no activa nada, no libera secretos, no publica release, no toca datos reales y no demuestra `VALIDATED_IN_PRODUCTION`.

Reversión: squash-revert del documento y del test. El workflow de aceptación se agregará únicamente tras ampliación V3 autenticada con PR abierto.