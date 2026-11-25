# Validate workflow_dispatch exact-main · AutoFactory #489

## Objetivo y límites

Validate admite push, pull_request y workflow_dispatch conservando el único check requerido **Validate / Pruebas y smoke Chrome**. El job ejecuta npm ci --ignore-scripts, npm test, las pruebas Python originales y el smoke real de carga de extensión Chrome MV3. El checkout está fijado al SHA del evento; en PR usa el HEAD del autor y mantiene el worktree del commit de merge para aceptación #240, exclusivamente bajo pull_request.

## Control de seguridad

Dispatch solo se admite para refs/heads/main con GITHUB_REF_TYPE=branch, GITHUB_EVENT_NAME=workflow_dispatch, identidad pl0n3r/AutoFactory y SHA de 40 caracteres de GITHUB_SHA. **No hay input sha**: un operador no puede elegir un hash por parámetro para simular la identidad. El primer paso comprueba con git ls-remote (lectura Git pública, sin token) que el HEAD de main coincide con el evento antes del checkout. El último paso comprueba que el checkout exacto terminó sin drift de main durante el smoke. Rama, tag, otro repo o SHA distinto fallan cerrado; no se obtiene un job verde por skip. Solo permissions: contents: read y persist-credentials: false, sin secretos, pull_request_target, publicación o auto-merge. Los guards dispatch no interfieren con push/PR y todos los tests siguen obligatorios.

## Criterios y evidencia

- AC-01: tests/test_validate_required_check.py::ValidateRequiredCheckTests::test_dispatch_exact_main_preserves_required_check cubre trigger, check canónico, permisos, control de rama/tag/repositorio, SHA malformado, drift remoto, drift post-smoke y checkout distinto con stub Git sin red.
- AC-02: Validate / Pruebas y smoke Chrome debe terminar success en HEAD exacto del PR; npm test, Python, smoke Chrome y test de hardening conservados.
- AC-03: **Tras squash**, el recibo auténtico exige run event=workflow_dispatch, head_branch=main, head_sha idéntico a main y job Validate / Pruebas y smoke Chrome terminal success. No sustituir con push ni fixture. Si el conector carece de acción POST dispatch, documentar pendiente en Issue #489 sin fabricar éxito ni habilitar el caller #488 ni Factory #2218.

## Fuera de alcance y reversión

Sin auto-merge Dependabot, secretos, datos reales, publicación, ampliación de permisos, cambio de branch protection, instalación/release ni go-live. Merge/CI no acreditan instalación Chrome/Safari ni salud productiva. Revertir squash revierte trigger y guards con el required check intacto.
