# AGENTES.md — AutoFactory

Este repositorio consume el núcleo operativo compartido de Factory v1:

https://github.com/pl0n3r/factory/blob/v1/agentes/NUCLEO.md

Lee también [PLAN-AGENTES.md](https://github.com/pl0n3r/factory/blob/main/PLAN-AGENTES.md) y `decisiones.yml` antes de tomar trabajo. Las decisiones globales del dueño tienen precedencia sobre esta capa.

## Capa local de la extensión

- **Producto:** ChatGPT Autopilot Local, extensión Chrome y Safari, no servidor web.
- **Stack:** JavaScript/Node.js (Node ≥20) y contenedor nativo Swift/Xcode para Safari.
- **Versión del paquete:** `manifest.json`, `package.json`, `package-lock.json` y manifiesto Safari deben coincidir en releases. Versionar solo cuando el corte requiera nueva versión instalable.
- **Fuente de verdad:** SHA de `main`, CI sobre SHA exacto, `CHANGELOG.md`, `docs/` y `decisiones.yml`.
- **Fase:** `construccion`. Los módulos `factory-control-*.js` del puente son contratos aislados hasta integrarlos, autenticarlos y comprobar la puerta legal.
- **Etiquetas:** `tipo:`, `prioridad:`, `estado:`, `rol:` en español. Un tipo, una prioridad y un estado por Issue y PR.
- **Ramas:** `trabajo/issue-N`. Recuperar PR existente antes de abrir otro; si el bot `/tomar` no está instalado en el repo, dejar comentario y `estado: reservado` sin inventar UUID.
- **Checks:** `npm test`, revisión de SonarCloud/CodeRabbit sobre el HEAD exacto y, para una versión instalable, paridad de Chrome/Safari y smoke de instalación/carga. Un CI verde sin smoke NO acredita una extensión entregada como VERDE.
- **Entrega reversible:** conservar la release anterior instalable. No crear paquetes ZIP ad hoc; respetar el pipeline oficial de releases y la instrucción del dueño de no entregar ZIPs.
- **Privacidad:** no registrar texto de conversaciones, tokens, correos ni rutas de chat identificables. Toda modificación de tratamientos personales exige actualizar `datos.yml` en el mismo PR y aplicar puertas legales cuando corresponda.
- **Puente con ControlBot:** sin endpoints reales, emparejamiento, permisos ampliados ni datos reales hasta autorización, consentimientos verificables, validación de seguridad y puerta legal [ControlBot#20](https://github.com/pl0n3r/ControlBot/issues/20). Prohibido usar automatización para eludir límites o controles de plataforma.
- **Production green de AutoFactory:** usar definición de extensión en `PLAN-AGENTES.md`, nunca inventar `/health`, despliegue de Hostinger o base de datos para un navegador.
- **Salud por pestaña:** `SIN AVANCE` es una señal local tras el umbral configurado por ausencia de respuesta o huella repetida; inspeccionar la pestaña indicada antes de intervenir. El log asociado queda limitado a 200 eventos y solo admite timestamps, estado, tab ID local y hash; nunca contenido de conversación.

## Colisiones y handoff

Serializa cambios en `popup.js`, `manifest.json` y su espejo Safari con otros PR abiertos. Máximo diez commits por PR y tres rondas de revisiones automáticas. Deja evidencia y bloqueos en GitHub; no declares completada una integración que aún no está cargada en runtime.
