# Diagnóstico SonarCloud desde GitHub

Issue #28. SonarCloud conserva el Quality Gate; este relay **no lo reemplaza** ni lo altera.

`.github/workflows/sonar-check-details.yml` ejecuta un script **del `main` confiable**
cuando SonarCloud completa su check. Confirma repositorio, PR abierto y SHA
exacto antes de consultar las anotaciones del check con `checks: read`.
El job de reporte dispone de `pull-requests: write` solo para mantener
un comentario del bot por PR. No descarga ni ejecuta código de la rama
del PR, y no necesita un token externo de Sonar.

Al fusionar este corte, un `push` a `main` inspecciona también los checks
Sonar ya terminados de los PR abiertos (incluidos los bloqueados) sin
reiniciar sus revisiones, con máximo 30 PR y 200 anotaciones leídas por check.
El comentario muestra un máximo de 30 anotaciones, ruta, línea y mensaje
acotado, junto al SHA y conclusión del check. Si GitHub no devuelve
anotaciones, declara expresamente que **faltan detalles**; nunca afirma
que el Quality Gate pasó ni que no hay hallazgos. Un resultado repetido
no genera otro comentario.

Probar sin red ni credenciales:

```sh
node test-sonar-check-relay.cjs
```

Este diagnóstico es independiente de PR #9, #23 y #27, y no modifica los
permisos de la extensión, releases, publicaciones ni tráfico ControlBot.
