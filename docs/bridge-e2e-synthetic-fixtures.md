# AutoFactory #286 — circuito E2E **sintético** del puente

**No es E2E live.** Esta batería Node es una prueba de composición **offline** de contratos de proyecto ya fusionados, sin Chrome/Safari, ControlBot, autenticación real, consentimiento del usuario, datos personales, conexión, secretos ni cambios de permisos. D-061 y ControlBot#20 continúan bloqueando cualquier flujo remoto o activación real. No cerrar el roadmap padre #133.

## Ejecución reproducible

```bash
node test-factory-control-bridge-e2e-synthetic.cjs
python3 -m unittest -v tests.test_bridge_e2e_synthetic_offline
npm test
```

El script `npm test` ejecuta ambos comandos antes de finalizar. `Validate / Pruebas y smoke Chrome` ejecuta `npm test` en el HEAD autenticado del PR; la salida requerida identifica ambas aceptaciones. El smoke Chrome del workflow **no** implica que el puente esté conectado, autorizado o instalado en clientes.

## Puertos y secuencia determinista

1. **Pairing:** `simulateSyntheticRevokeReplay('consumed')` prueba challenge ficticio, consumo único y rechazo de reutilización; ninguna credencial real se almacena.
2. **Heartbeat:** `createHeartbeatFakeclockSimulation` con consentimiento y snapshot inventados, reloj fijo, entrega local confirmada y tick posterior rechazado por cadencia.
3. **Admisión:** `evaluate` comprueba una única señal sintética `ready`, fresca y no repetida; esta decisión *no habilita* operaciones remotas.
4. **Orden/ACK:** `createReplaySimulator` con `createMemoryReceiptStorage` ejecuta un efecto ficticio; tras pérdida de ACK, la segunda instancia lee el ledger y rechaza replay (`already_handled`), sin duplicar el efecto.
5. **Revocación:** `simulateSyntheticRevokeReplay('revoked')` elimina la credencial ficticia y niega nuevos pairings.
6. **Kill/rollback:** `createFactoryControlKillSwitch` detiene, revoca y restaura mediante callbacks de memoria; la marca terminal bloquea posteriores comandos y la segunda llamada es idempotente.

Cada etapa se aserta en orden. La evidencia pública es una lista cerrada de **códigos de categoría**, sin alias de perfil, PIN, handle, command ID, contenido de conversaciones ni excepciones de adaptadores.

## Casos negativos y comportamiento cerrado

- Señal de límite o login, observación stale, observación replayed, señal desconocida y simultaneidad contradictoria: `canResume=false`.
- Orden revocada, caducada y frame con campo extra: `unauthorized`, `timeout`, `invalid`, sin efectos adicionales.
- Consentimiento heartbeat revocado: `denied`, presencia `unknown`, ninguna entrega.
- Puerto heartbeat inválido: se rechaza antes del tick.
- Fallo del adaptador `stopBridge`: `rollback_failed`, sin llamar a restauración y sin admitir nuevas órdenes.
- Excepción inesperada del harness: solo mensaje de error fijo; no se imprime entrada ni stack del adaptador.

**Invariantes:** transportes en memoria, `Date.now` sustituido por relojes deterministas donde procede, sin activación, sin red y sin fixture personal. Un test verde demuestra exclusivamente comportamiento offline del harness, nunca consentimiento, cumplimiento legal, readyness de producción ni E2E browser/live.

**Reversión:** revertir el squash de #286 elimina los tres archivos de fixtures/pruebas y restaura únicamente el enlace añadido a `package.json`. No cambia el runtime ni la extensión distribuida.
