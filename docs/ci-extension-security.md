# CI de AutoFactory (adopción Factory v1)

El workflow `.github/workflows/validate.yml` es propio de la extensión
JavaScript. El reusable `factory/ci.yml@v1` actualmente acepta stacks
`php|symfony|laravel` y por eso **no** se lo invoca con un stack inventado.

El workflow de extensión emplea `actions/checkout` y `actions/setup-node`
fijadas a los SHA usados por Factory v1. El checkout no conserva credenciales
Git; el `GITHUB_TOKEN` solo tiene `contents: read`. El job expira en
20 minutos y los builds obsoletos de una misma ref pueden cancelarse, salvo
la rama `main`, que debe conservar su evidencia. Se mantiene Node 20,
`npm ci` y `npm test` en el job `test`. El contrato
`node test-workflow-hardening.cjs` da una señal negativa verificable si
se vuelven a introducir tags mutables, tokens persistentes o permisos write.

Este corte no cambia el workflow de publicación de releases. No constituye
un smoke de carga Chrome/Safari, artefacto reproducible ni versión reversible
de la extensión. Tampoco activa red hacia ControlBot ni toca datos reales.
