# Vuelta atrás local de AutoFactory (Chrome / Safari)

**Alcance de #427:** procedimiento de uso personal con carpetas de código obtenidas del repositorio, verificación offline del SHA Git y versión, y pruebas ficticias. **No** se ha instalado ni revertido una extensión en navegadores reales. Un merge o un test PASS no es smoke Chrome/Safari ni autoriza una publicación.

## 1. Preparar dos carpetas independientes y una referencia confiable

1. Conservar la carpeta actual y las preferencias locales, **sin eliminar perfiles, `chrome.storage`, llaves o datos del navegador**. Detener manualmente la automatización antes de intervenir.
2. Identificar en GitHub el **commit SHA completo de 40 caracteres** de la versión anterior y su versión `X.Y.Z`; anotarlos **fuera de la carpeta que se verificará** (por ejemplo, en un registro del dueño). No confiar en el número declarado por la propia carpeta.
3. Desde un clon del repositorio con los commits accesibles, preparar una carpeta **limpia** por versión, sin editar los archivos ni ejecutar `npm install` dentro de ellas. Ejemplo (reemplazar los valores, sin usar SHA abreviados):

   ```bash
   git worktree add --detach ../autofactory-anterior <SHA_ANTERIOR_40_HEX>
   git worktree add --detach ../autofactory-actual <SHA_ACTUAL_40_HEX>
   ```

4. El verificador acepta únicamente **raíces de checkout Git** con árbol de archivos exactamente igual al commit fijado: compara cada blob Git con el archivo local, rechaza archivos añadidos/eliminados, enlaces simbólicos y versiones inconsistentes. Una carpeta descomprimida sin `.git` no acredita su commit: **rechazarla**, no saltarse el control ni construir un SHA a partir de su nombre. No usar `git reset --hard`, `git clean -fd` ni comandos destructivos para forzar que una carpeta pase: preparar una nueva carpeta limpia.

## 2. Verificación previa obligatoria (offline)

El script está en el checkout de AutoFactory que contiene esta documentación. Ejecutarlo desde ese checkout, usando el SHA y versión consultados de forma independiente:

```bash
python3 scripts/verify_extension_version.py ../autofactory-anterior --sha <SHA_ANTERIOR_40_HEX> --version <VERSION_ANTERIOR>
python3 scripts/verify_extension_version.py ../autofactory-actual --sha <SHA_ACTUAL_40_HEX> --version <VERSION_ACTUAL>
```

La salida `VERIFICADO` identifica la carpeta, SHA, versión y número de archivos; el estado **RECHAZADO** y el código de salida distinto de cero impiden continuar. Se contrastan `manifest.json` Chrome y su espejo Safari, `package.json`, `package-lock.json` y la versión raíz del lock. **No** verifica firma de un instalador, origen de un ZIP, la identidad del propietario remoto ni un navegador instalado. Un commit SHA sin fuente externa confiable tampoco prueba autoría. No introducir credenciales ni texto de chats en este procedimiento.

## 3. Chrome — cargar manualmente la versión anterior

1. Detener el piloto y cerrar acciones en curso. Confirmar la verificación `VERIFICADO` de **la carpeta anterior** inmediatamente antes de usarla.
2. Abrir `chrome://extensions`, activar **Modo de desarrollador** y localizar la instalación actual. **Desactivarla** primero; no borrarla para “limpiar” el perfil ni asumir que cambiar carpetas preserva el mismo ID de extensión.
3. Pulsar **Cargar descomprimida**, seleccionar la **raíz `../autofactory-anterior`** (la que contiene `manifest.json`) y comprobar que Chrome informa la versión esperada. No seleccionar la versión actual ni un ZIP.
4. Comprobar de forma manual que abre el popup, que el piloto sigue detenido por defecto y que no aparecen permisos inesperados o errores. Si Chrome rechaza la carga, el ID/almacenamiento cambia inesperadamente o aparece una solicitud de permisos no prevista: **detenerse**, no activar automatización ni manipular el perfil.
5. Guardar únicamente fecha, SHA, versión, navegador y resultado de la comprobación; **no** registrar conversaciones, cookies, tokens, identificadores de chat ni capturas privadas. Una verificación local no constituye por sí sola un smoke de instalación acreditado.

## 4. Safari — solo si se utiliza y hay Mac/Xcode disponible

1. Conservar la extensión actual deshabilitada y su proyecto sin modificar. En macOS, preparar la carpeta anterior como checkout Git limpio y ejecutar primero el verificador de la sección 2.
2. En **esa carpeta anterior**, ejecutar `./build-safari.sh` para sincronizar las fuentes web declaradas con `safari/ChatGPT Autopilot Local Extension/Resources/`, y **volver a verificar el SHA y la versión**. Si se modificó algún archivo versionado o aparece un archivo inesperado, detenerse; no parchear ni ignorar el fallo.
3. Abrir `safari/ChatGPT Autopilot Local.xcodeproj` desde la versión anterior. Compilar/ejecutar solo en el entorno local autorizado; activar manualmente la extensión en **Safari > Ajustes > Extensiones** si la instalación permite hacerlo. No asumir firma, Team ID o permisos ya aprobados.
4. Confirmar manualmente versión, activación de la extensión, popup, errores, ausencia de solicitudes de permisos inesperados y sin tráfico de pairing con ControlBot. Ante diferencias de firma/identidad o dudas sobre la conservación de preferencias, mantenerla deshabilitada y escalar al dueño.
5. Un build Xcode *unsigned* o una comprobación de archivos no acredita `SMOKE_SAFARI_REAL`; el dueño verifica Safari real durante su sesión. Esta tarea no lo ejecuta.

## 5. Reversión de la reversión, evidencia y pruebas

Si el rollback falla, desactivar la versión anterior, conservar **ambas** carpetas y evidencias y regresar solo a una instalación actual previamente verificada, sin borrar ni restaurar perfiles por fuerza. No realizar distribuciones públicas, generar ZIP ad hoc, crear tags o releases, alterar los manifests instalables, habilitar ControlBot ni usar datos reales.

Pruebas sintéticas locales **sin navegador**, sin red y sin tocar archivos reales:

```bash
python3 -m unittest -v tests.test_rollback_extension
```

La prueba crea **dos repositorios de mentira** con versiones distintas; verifica que pasan con su SHA fijado externamente y que fallan cuando se cambia el SHA, la versión, un archivo JavaScript, el manifiesto Safari, se agrega un archivo o se elimina `.git`. El trabajo termina en **VALIDADO EN CÓDIGO** una vez pasen las puertas del PR; el rollback del navegador real sigue pendiente de observación humana independiente.
