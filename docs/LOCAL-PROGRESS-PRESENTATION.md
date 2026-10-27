# Presentación local de progreso (solo fixtures)

Hoja AutoFactory #250, aprobación del dueño #249/A y dependencia #246 integrada.

## Contrato de seguridad

El popup comienza en UNKNOWN · sin fuente conectada, con la vista local apagada por defecto. La tarjeta no incorpora consultas de pestañas, listeners, persistencia, red, pairing, credenciales ni un proveedor de datos. Los otros dos estados ACTIVA y SIN_AVANCE se muestran únicamente cuando una prueba sintética invoca directamente el renderizador interno. Las entradas no permitidas vuelven a UNKNOWN.

La salida se asigna exclusivamente mediante textContent, role=status y aria-live=polite. No añade paradas de tabulación ni modifica los botones existentes. Ningún texto, URL o ID de conversación real se procesa.

## Chrome/Safari

Los archivos popup.html y popup.js en la raíz y en safari/ChatGPT Autopilot Local Extension/Resources se mantienen byte a byte idénticos. Esta paridad estática NO demuestra instalación ni ejecución interactiva en Safari; su smoke real sigue pendiente en el Issue #122.

## Verificación

Comando: python3 -m unittest -v tests.test_local_progress_presentation

El workflow Validate / Pruebas y smoke Chrome invoca los tres métodos nominales de aceptación, además de npm test y su smoke efímero de Chrome. No se cambia manifest, permisos, package version, release ni hosting. SonarCloud main #219 sigue con su fuente de hallazgos pendiente. D-061 y la decisión #242/B mantienen prohibido el puente real.

El estado expone `tabindex="0"` para foco de teclado en Chrome y Safari. La pantalla muestra «SIN AVANCE» en español y preserva `SIN_AVANCE` como identificador interno.
