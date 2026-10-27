# AutoFactory · compatibilidad de estado local entre versiones (#263)

**Alcance:** auditoría y pruebas sintéticas offline de migración y rollback. **NO es smoke en hardware real** ni ejecución de un actualizador de Chrome o Safari. No certifica instalación, firma, acceso a cuentas, publicación de release, go-live ni paridad de persistencia nativa.

## Inventario de fuentes y claves observadas

| Fuente | Claves/localidad | Riesgo y límite |
| --- | --- | --- |
| `popup.js`, igual en `safari/ChatGPT Autopilot Local Extension/Resources/popup.js` | `prompt`, `promptSchemaVersion`, `settingsDefaultVersion`, `masterEnabled`, `delaySeconds`, `conversationMode`, `reloadCooldownMinutes`, banderas de scroll/reload | La UI tiene compatibilidad con defaults por versión, pero **no** existe prueba de migración atómica de todo el almacenamiento. Un campo de versión futura no debe ejecutarse por un lector viejo |
| `account-budget.js`, idéntico Chrome/Safari | `accountBudgetStateV1`, `accountBudgetSnapshotV1`, `factoryAccountBudgetV1` | Contadores y límites locales. No restablecer cuotas ni eludir restricciones de ChatGPT |
| `background.js`, idéntico Chrome/Safari | `autopilotRecoveryIncidentsV1`, `factoryControlInstanceReceiptsV2` | Solo diagnósticos y recibos acotados, nunca contenido de conversaciones |
| `popup.js`, Chrome/Safari | `factoryControlLanAgentKeyV1` | **Secreto potencial** de conexión LAN: fuera de exportación, fixtures y logs |
| `factory-control-chrome-storage.js`, exclusivo del árbol Chrome | `factoryControlProfileCredentialsV1`, `factoryControlCommandReceiptsV1` | Credenciales locales opacas; no copiar ni retener credenciales. No afirmar que el adaptador Chrome se entregue también en Safari |

Este inventario no garantiza enumeración exhaustiva de todas las claves de una instalación real. Safari puede utilizar un almacenamiento distinto, aunque los tres archivos citados sean idénticos en el árbol Git de este corte. Todos los tests leen **fuentes del repositorio**, no perfiles de navegador.

## Prueba offline de compatibilidad v1/v2

El archivo `tests/test_extension_local_upgrade_migration.py` implementa un **modelo de copia de fixtures**, no una migración de producto. Se ejecuta con `python3 -m unittest -v tests.test_extension_local_upgrade_migration`.

1. Crear una copia sintética con `masterEnabled:false`, demora válida, `conversationMode:chat` y `futureSyntheticFlag:true`; **sin** texto de chats, prompt, tokens, cookies ni credenciales.
2. Ejecutar `upgrade` de v1 a v2: default seguro `reloadCooldownMinutes`, marca `settingsDefaultVersion:2` e input intacto. Volver a cargar el snapshot en un **reinicio** simulado y exigir idempotencia.
3. Ejecutar `downgrade` a v1: los campos futuros se mantienen como **datos inertes** en la copia; no se interpretan ni se borran. Volver a `upgrade` y comparar toda la instantánea con la primera v2.
4. Ante formatos inválidos, objetos desconocidos, versiones futuras no soportadas o indicios de contenido sensible: **fail-closed**, sin modificar original ni borrar el almacenamiento de ningún navegador.
5. La frontera de credenciales se prueba por rechazo explícito de claves sensibles y lectura de nombres desde código, **no** leyendo valores reales.

**Limitación esencial:** que estas pruebas pasen no demuestra que el popup real, la API `chrome.storage.local` o Safari efectúen estas operaciones sin pérdida en hardware.

## Checklist de instalación / actualización y rollback real — NO ejecutado

- [ ] Verificar versión y firma del paquete previo y del candidato Chrome/Safari, SHA del origen, permisos y plan de reversión aprobado.
- [ ] Usar exclusivamente perfil **desechable**, sintético y autorizado; no usar cuenta, chats, credenciales ni cookies reales.
- [ ] Instalar versión anterior, comprobar configuraciones sintéticas, detener/reiniciar ambos navegadores y tomar un baseline sin identificadores.
- [ ] Aplicar `upgrade` en Chrome y Safari/Xcode con los paquetes oficiales, comprobar defaults, persistencia de preferencias inocuas y reinicio.
- [ ] Probar `downgrade` y `rollback` reversible al paquete firmado anterior; detectar campos futuros desconocidos sin ejecutarlos ni perder preferencias permitidas.
- [ ] Inyectar un snapshot sintético mal formado en entorno desechable y confirmar fallo seguro. **No borrar** ni sobrescribir datos reales por corrupción.
- [ ] Verificar gestión independiente de claves opacas: `factoryControlLanAgentKeyV1`, `factoryControlProfileCredentialsV1`; nunca migrarlas entre perfiles ni exportar credenciales.
- [ ] Registrar solo resultado PASS/FAIL, SHA, versiones, dispositivo de prueba y evidencias saneadas; no incluir conversaciones ni identificadores.

**No es autorización de release.** Un PR de documentación/test no satisface el smoke real de instalación (#122), ni las puertas de firma, permisos, privacidad, ControlBot D-061 o producción. Los límites de ChatGPT siguen intactos.
