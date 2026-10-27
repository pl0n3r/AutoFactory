# AutoFactory #287 — dictamen NO-GO y recibo de readiness sintético

**Decisión real: NO-GO. NO_ACTIVAR_BRIDGE.** Este documento es un borrador técnico reproducible, exclusivamente offline y con datos ficticios. No constituye consentimiento, autorización, evidencia de producción, validación legal, aprobación de seguridad ni entrega LIVE/VALIDADO. #134 y #1 permanecen abiertos.

## Puertas humanas y evidencia exigida para cualquier revisión futura

| Puerta independiente | Evidencia auténtica que faltaría para reabrir decisión | Estado real en este slice |
| --- | --- | --- |
| E2E #133 | Identidad/autorización y trazas mínimas de ejecución con revocación y replay validadas, sin contenido de chats | NO-GO; #286 solo E2E sintético |
| D-061 / ControlBot#20 | Consentimiento informado autenticado, revocable, finalidad, retención y puerta legal | NO-GO; sin autorización real |
| Seguridad #219 | Hallazgos severos resueltos, SonarCloud y CodeQL de fuente confiable y firma de seguridad | NO-GO; un CI verde no sustituye evidencia |
| Safari #122 | Smoke de instalación real en Safari/Xcode, paridad y permisos mínimos | NO-GO; CI Chrome no acredita Safari |
| Protección | Reglas de rama vigentes, gates de checks exact-SHA y revisión de riesgos verificables | NO-GO; estado desconocido no equivale a aprobado |
| Rollback | Copia instalable anterior, procedimiento y ensayo restaurable con trazabilidad | NO-GO; no se ha ejecutado rollback real |
| OWNER | Decisión expresa del dueño para autorización/activación sobre evidencia completa | NO-GO; ninguna prueba o bot puede otorgarla |

Las siete filas son **dependencias**, no aseveraciones verificadas. Solo el OWNER, tras revisar evidencia independiente actual y legalmente válida, podría autorizar pasos separados de activación. D-061, ControlBot#20, #89, #219, #122 y #133 no quedan satisfechos por la simulación ni por la fusión.

## Recibo de prueba determinista (datos inventados)

El siguiente objeto es un **fixture positivo exclusivamente sintético**: sus siete tickets son falsos y frescos en ticks artificiales, pero `owner_gate` permanece `NOT_GRANTED` y `decision` permanece `NO_GO`. Ninguno contiene endpoints, usuarios, tokens, cookies, conversaciones, telemetría ni identificadores reales. `synthetic_complete` solo significa que la prueba documental tiene todas sus entradas falsas; **nunca** que el puente esté habilitado.

```json
{
  "schema": "bridge-live-readiness-preview/v1",
  "mode": "OFFLINE_SYNTHETIC",
  "decision": "NO_GO",
  "owner_gate": "NOT_GRANTED",
  "now_tick": 500,
  "evidence": {
    "e2e_133": {
      "state": "SIMULATED",
      "receipt_id": "fixture:e2e_133",
      "observed_tick": 495,
      "revoked": false,
      "replayed": false
    },
    "consent_d061": {
      "state": "SIMULATED",
      "receipt_id": "fixture:consent_d061",
      "observed_tick": 495,
      "revoked": false,
      "replayed": false
    },
    "security_219": {
      "state": "SIMULATED",
      "receipt_id": "fixture:security_219",
      "observed_tick": 495,
      "revoked": false,
      "replayed": false
    },
    "safari_122": {
      "state": "SIMULATED",
      "receipt_id": "fixture:safari_122",
      "observed_tick": 495,
      "revoked": false,
      "replayed": false
    },
    "branch_protection": {
      "state": "SIMULATED",
      "receipt_id": "fixture:branch_protection",
      "observed_tick": 495,
      "revoked": false,
      "replayed": false
    },
    "rollback": {
      "state": "SIMULATED",
      "receipt_id": "fixture:rollback",
      "observed_tick": 495,
      "revoked": false,
      "replayed": false
    },
    "owner_only": {
      "state": "SIMULATED",
      "receipt_id": "fixture:owner_only",
      "observed_tick": 495,
      "revoked": false,
      "replayed": false
    }
  }
}
```

## Semántica de aceptación fail-closed

- Un ticket ausente, desconocido, repetido/replayed, revocado, con timestamp futuro o con edad mayor que 60 ticks produce `NO_GO` y `synthetic_complete=false`.
- Una declaración de activación, `LIVE`, `VALIDADO`, permiso del OWNER o estado de consentimiento real dentro del recibo se rechaza, incluso con CI, SonarCloud o CodeQL `success`.
- Las pruebas validan el recibo y sus mutaciones **sin red ni navegador**. No existen escrituras, host permissions, comunicación con ControlBot ni cambio al runtime de Chrome/Safari.
- Ejecutar localmente `python3 -m unittest -v tests.test_bridge_live_readiness_preview`; en CI esta misma suite se añade únicamente al `npm test` existente que ejecuta el check requerido `Validate / Pruebas y smoke Chrome` sobre el HEAD exacto.
- Este corte **no cierra** los roadmaps #129–#134 ni el épico #1; revertir los dos archivos nuevos y la adición en el script de pruebas restaura el estado anterior.
