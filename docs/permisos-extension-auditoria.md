# Auditoría de permisos de extensión Chrome y Safari

**AutoFactory #265 · fase `construccion` · análisis estático, no prueba de instalación.** Fuente: `manifest.json` y `safari/ChatGPT Autopilot Local Extension/Resources/manifest.json`. Ambos manifests son idénticos en el árbol de partida; la suite compara su contenido y rechaza divergencias.

## Matriz de permisos y superficies

| Grupo | Entrada exacta | Finalidad y evidencia del código | Frontera de consentimiento y minimización |
| --- | --- | --- | --- |
| permissions | `activeTab` | Capacidad temporal asociada a la interacción del usuario con la pestaña; el popup consulta la pestaña activa en `popup.js` (`activeTab()`). La necesidad independiente de esta capacidad debe reevaluarse antes del release; la API visible es `tabs.query`. | No implica lectura indiscriminada ni acceso a otras páginas; preferir alcance de pestaña activa. |
| permissions | `storage` | Preferencias de uso guardadas con `extensionApi.storage.local` en `popup.js`, `background.js` y `factory-control-chrome-storage.js`. | Persistir solo valores permitidos; revisar datos sensibles por separado, sin incluirlos en esta auditoría. |
| permissions | `tabs` | `extensionApi.tabs.query` y `tabs.sendMessage` en `popup.js` y `background.js`, con selección de `https://chatgpt.com/*`. | Envío de comandos a pestañas habilitadas, no permiso genérico para leer contenido de cualquier sitio. |
| permissions | `alarms` | `extensionApi.alarms.create` y `alarms.onAlarm` en `background.js` para heartbeat local. | No concede tráfico externo ni justifica ejecución remota. |
| host_permissions | `https://chatgpt.com/*` | Único host requerido por el manifest; coincide con `content_scripts.matches`. | Acceso a ese origen solamente; el consentimiento a permisos no aprueba el tratamiento o envío de conversaciones. |
| optional_host_permissions | `http://127.0.0.1:8777/*` | Integración loopback local y toggle explícito en `popup.js` (`LOCAL_CONTROL_HOST`, `permissions.request`). | Solicitud solo tras gesto de usuario, revocable y OFF por defecto; no equivale a conexión activa. |
| optional_host_permissions | `http://*/*` | Patrón opcional amplio para una dirección LAN privada validada en `popup.js` mediante `privateOrigin` y `permissions.request`. | **SUPERFICIE SENSIBLE:** cubre potencialmente orígenes HTTP más amplios que LAN. No se debe tratar como permiso concedido, ni convertirlo en `host_permissions`. Revisar reducción de patrón antes de release; exigir autorización del usuario para origen concreto. |
| content_scripts.matches | `https://chatgpt.com/*` | Inyección declarativa de scripts de contenido en el sitio permitido, descrita en los manifiestos Chrome/Safari. | No ampliar a otros hosts ni introducir comodines de Internet. |

## Criterios de minimización antes del release

1. Mantener `host_permissions` limitado a `https://chatgpt.com/*` y `content_scripts.matches` en el mismo origen. Toda expansión exige decisión y tests nuevos.
2. Mantener `optional_host_permissions` separadas de los permisos obligatorios. `http://*/*` es una exposición de alcance considerable, **no** una aprobación general ni una promesa de que el navegador la limite por sí mismo a la LAN. Verificar por separado el origen exacto solicitado y los controles de `popup.js`.
3. Auditar si `activeTab` sigue siendo necesario cuando `tabs` y un host fijo están presentes; ninguna eliminación o ampliación de permisos se realiza en este issue.
4. Solicitar explícitamente el consentimiento y respetar revocación para orígenes opcionales. D-061 exige puertas legales y seguridad antes de tráfico real con ControlBot; este documento **no autoriza** pairing, credenciales, chats o transmisión a servidores.
5. Antes de distribución, verificar físicamente la instalación y los permisos efectivos en **Chrome y Safari** según #122. La igualdad de manifests, un build Safari unsigned o el CI sintético **no acreditan** smoke instalado real.

## Regresión, reversión y límites

`python3 -m unittest -v tests.test_permisos_extension_auditoria` coteja de forma determinista los dos manifiestos, el inventario exacto (listas obligatorias y opcionales) y los controles documentales. Rechaza permisos o hosts adicionales, listas malformadas, comodines obligatorios y divergencia entre Chrome/Safari. No crea permisos, no instala navegador, no hace red y no toca perfiles.

**Archivos de ejecución fuera de alcance:** `manifest.json`, `safari/ChatGPT Autopilot Local Extension/Resources/manifest.json`, `popup.js`, `background.js`, módulos de ControlBot, permisos instalados y datos del usuario. El diff autorizado contiene solo este documento y `tests/test_permisos_extension_auditoria.py`; el PR debe confirmar esa restricción. Revertir el squash elimina exclusivamente esta auditoría y la regresión, sin modificar las extensiones instaladas.
