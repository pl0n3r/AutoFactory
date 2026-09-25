# Preflight estático de fuentes de extensión

Issue #22. Uso en el checkout (Node.js >= 20):

```sh
node scripts/verify-extension-assets.cjs
npm test
```

El comando **solo lee archivos**. Compara la versión `manifest.json`,
`package.json` y `package-lock.json` y sus recursos activos con los archivos
del contenedor Safari. También inspecciona los `<script src>` locales del popup,
incluido `popup.js`, aunque no aparezcan directamente en el manifiesto. Todos
los scripts/HTML/iconos declarados deben existir
como archivos regulares, sin enlaces simbólicos, y ser byte a byte idénticos
en los dos árboles. El manifiesto Safari también es idéntico al de Chrome.

Por defecto, durante `construccion`, solo están permitidos
`https://chatgpt.com/*` y los permisos actuales
(`activeTab`, `alarms`, `storage`, `tabs`). Cualquier ampliación requiere
un cambio explícito de la prueba, evaluación de privacidad y, si hay una
nueva finalidad/proveedor de datos, la puerta legal correspondiente. El
origen ControlBot no se habilita aquí.

La prueba `test-extension-integrity.cjs` usa cambios en memoria, sin escribir
assets, y se invoca a través de `test-factory-governance.cjs` en `npm test`.
Verifica deriva entre navegadores, versión inconsistente, recurso faltante,
symlink (incluidos directorios raíz Safari), traversal, atributos src ambiguos y ampliaciones de permisos/orígenes requeridos u opcionales.

**Lo que NO acredita:** instalación/carga real de Chrome, compilación y
firma Xcode/Safari, artefacto de release reproducible, versión anterior para
rollback o conexión segura a ControlBot. La definición de VERDE de Factory
exige evidencias adicionales por navegador y release. Este cambio no genera
ni publica paquetes ZIP y no altera el workflow de releases existente.
