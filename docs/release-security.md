# Puerta de publicación de AutoFactory

El workflow `.github/workflows/release.yml` solo se dispara por una etiqueta
de versión. Antes de crear ningún paquete exige:

1. `npm ci` y `npm test` con Node 20.
2. Tag `vX.Y.Z` igual al `manifest.json` de Chrome, manifest Safari,
   `package.json`, `package-lock.json` y el paquete raíz del lock.
3. Que el commit etiquetado sea el **HEAD exacto** de `origin/main`
   disponible en el checkout de profundidad completa.

El job `publish` vuelve a consultar el HEAD actual de `main` con la API de
GitHub justo antes de empaquetar. El resultado anterior de `preflight` no se
considera vigente si `main` cambió entre jobs.

La fase `preflight` solo tiene `contents: read`; la fase `publish`
requiere que preflight haya pasado y usa `contents: write` para crear la
publicación. Ambas usan checkout fijado a SHA, sin credenciales Git
persistentes, y límites de tiempo. La concurrencia impide dos publicaciones
simultáneas de la misma etiqueta; no cancela la publicación previa.

Prueba local sin empaquetar ni publicar:

```sh
node test-release-workflow.cjs
node scripts/verify-release-metadata.cjs v1.6.2
```

Este cambio **no ejecuta** `scripts/package-release.py`, no crea una
etiqueta, no adjunta ZIPs y no cambia la publicación existente. Solo endurece
sus condiciones de entrada para un futuro disparo por tag. No sustituye
smoke de carga Chrome/Safari, revisión legal ControlBot#20 ni evidencia de
versión anterior instalable exigida por Factory para VERDE.
