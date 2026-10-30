# AutoFactory #430 — interrupción local del pairing (OFF)

## Alcance y decisión del dueño

El dueño dispuso un interruptor de apagado local con descarte de órdenes y borrado del token local. La decisión jurídica #242/B y D-061 mantienen el puente real **apagado**; no se autorizan tráfico, emparejamiento, permisos, tokens verdaderos ni operación de ControlBot. Esta entrega añade **pruebas y documentación al contrato aislado que ya existe** en `factory-control-kill-switch.js`; los botones del popup permanecen deshabilitados hasta una hoja autorizada para wiring.

## Contrato que se comprueba

`createFactoryControlKillSwitch` recibe adaptadores explícitos `executeCommand`, `stopBridge`, `revokePairing`, `restoreSafeState` y reloj `now`. `kill()` aplica antes de efectos externos el cierre sincrónico de nuevas órdenes, solicita abortar las iniciadas y llama a stop/revocar independientemente. La cola y el token son ficticios y se eliminan **en los adaptadores de la prueba**, no en cuentas reales. El resultado es idempotente y no muestra errores sensibles.

El estado `safe` solo significa que los adaptadores sintéticos confirmaron stop, revocación, restauración y que no había órdenes en vuelo. Una orden en vuelo no es revocación confirmada: deja `rollback_failed`, incluso si hubo aborto local. Stop no confirmado por timeout o error impide restauración insegura. La fuente `observedAt` es un timestamp local que se presenta como `America/Bogota`, 12 horas; no se publican chat, cookies ni credenciales.

## Ejecución y límites

`python3 -m unittest -v tests.test_kill_switch_pairing` ejecuta cinco escenarios Node deterministas: stop sin respuesta remota, borrado ficticio, fence de órdenes en vuelo, revocación falsa, timeout, idempotencia y registro redaccionado. No hay `fetch`, login ni llamada a ControlBot. También se conserva `node test-factory-control-kill-switch.cjs` del módulo existente.

Los dos archivos reclamados son `tests/test_kill_switch_pairing.py` y `docs/kill-switch-pairing.md`. No se modifica el popup, background, manifest, Safari ni runtime; el wiring con almacenamiento real requiere otra reserva con claims propios y aprobación explícita. No hay go-live o release de extensión por esta prueba. Revertir el squash retira únicamente suite y guía, sin activar ningún puente.

Para fusionar: reserva V3 auténtica y `Validate / Pruebas y smoke Chrome` terminal sobre HEAD exacto, SonarCloud requerido en el ruleset, CodeQL, revisión FINAL CodeRabbit según el plan. SonarCloud en `main` continúa Security B/Reliability D: no equivale a un gate satisfecho.
