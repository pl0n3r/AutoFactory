# Observación local de reservas V3 — Fase A · AutoFactory

## Alcance y seguridad

Caller idéntico al template de [Factory #1382](https://github.com/pl0n3r/Factory/issues/1382), publicado en `Factory@v1` (1.0.39). Este workflow observa **solo** reservas del repositorio AutoFactory usando su `GITHUB_TOKEN` local con scopes de solo lectura (`contents`, `issues`, `pull-requests`, `checks`, `actions`). Reutiliza `pl0n3r/Factory/.github/workflows/observador-reservas-consumidor.yml@v1`; no copia la lógica de coordinación, no contiene tokens o secretos y no accede a ControlBot.

Ejecuta `schedule` cada 10 minutos más `workflow_dispatch` para diagnóstico. Usa exclusión serial `lease-consumer-caller-${{ github.repository_id }}` sin cancelación de la corrida anterior. No realiza `POST`, `PATCH`, `DELETE`, libera reservas, modifica PR/Issues, añade labels ni habilita pairing de la extensión. El reusable declara explícitamente `FACTORY_LEASE_AUTO_RELEASE_ENABLED: 'false'`. La captura de evidencia incompleta debe quedar `UNKNOWN` y fallar cerrada.

## Criterios operativos que aún NO se acreditan

Un workflow `success` no demuestra que AutoFactory haya completado 24 horas y 100 ciclos **terminales y válidos** con evidencia autenticada, ni que exista QA individual de cada hipotético `release`, cero falsos positivos, ausencia genuina de actividad y CAS/lock real. Los ciclos omitidos por cuota, sin candidatos y `UNKNOWN` no cumplen la puerta. La Fase B continúa desactivada incluso cuando este PR se fusione; requiere Issue/PR y autorización propios.

## Validación y reversión

`python3 -m unittest discover -s tests -p test_observador_reservas_consumidor.py` ejecuta dos pruebas deterministas con casos adversariales. La suite se integra al `test-workflow-hardening.cjs` ya ejecutado en Validate, sin modificar `package.json` reclamado por #226. No se cambia la versión instalable de Chrome/Safari.

Si el observador genera consumo inesperado de Actions o evidencia incompleta, revertir el PR que introduce este caller, su test y este documento. Eliminar el caller deshabilita nuevos disparos sin afectar la coordinación ya existente. Quedan pendientes #219 (Sonar main) y #220 (required check `test` de main); no se reduce ningún gate para facilitar el merge. No hay deploy, go-live, tratamiento de datos de chats, tokens o cambios de permisos del navegador.
