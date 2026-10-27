"""AutoFactory #261: pruebas documentales offline, sin navegador ni PII."""
from __future__ import annotations

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNBOOK = ROOT / "docs" / "operacion-soporte.md"


def runbook() -> str:
    if not RUNBOOK.is_file():
        raise AssertionError("Falta docs/operacion-soporte.md")
    return RUNBOOK.read_text(encoding="utf-8")


class OperacionSoporteTests(unittest.TestCase):
    def test_incidentes_triage_severidad_parada_recuperacion(self):
        text = runbook()
        for heading in (
            "## Señales locales y límites de observación",
            "## Matriz de severidad y escalamiento",
            "## Triage manual: identificar, diagnosticar y PARADA",
            "## Recuperación manual y parada segura por escenario",
            "## Ventanas, notificaciones y revisión diaria",
            "## Cierre de incidente y frontera de producción",
        ):
            with self.subTest(heading=heading):
                self.assertIn(heading, text)
        for severity in ("SEV-1", "SEV-2", "SEV-3", "SEV-4"):
            self.assertIn("| " + severity + " ", text)
        for case in ("Navegador cerrado", "ChatGPT no responde", "Sesión expirada",
                     "Cuota o rate limit", "SIN_AVANCE confirmado", "UNKNOWN"):
            self.assertIn(case.lower(), text.lower())
        for action in ("PARADA", "triage", "escalar", "consentimiento",
                       "recuperación manual", "no reenviar", "D-061"):
            self.assertIn(action.lower(), text.lower())

    def test_privacidad_estricta_sin_textos_ni_pii(self):
        text = runbook()
        privacy = text.split("## Privacidad: lista positiva y lista prohibida (D-062)", 1)[1].split("\n## ", 1)[0]
        for term in ("**Lista positiva**", "**PROHIBIDO:**", "PII",
                     "texto de chat", "prompts", "tokens", "secretos",
                     "correos", "URL/ID de conversación", "capturas de pantalla",
                     "logs/storage", "no compartir"):
            with self.subTest(term=term):
                self.assertIn(term.lower(), privacy.lower())
        self.assertIn("200 eventos", privacy)
        self.assertIn("300 eventos / 7 días", privacy)
        self.assertIn("No pegar contenido sensible en GitHub", privacy)
        self.assertIn("D-062", text)

    def test_monitoreo_local_no_alertas_remotas(self):
        text = runbook()
        for term in ("local-tab-progress.js", "account-budget-background.js",
                     "popup", "clasificación offline", "inicia UNKNOWN",
                     "Alertas externas NO DESPLEGADAS",
                     "cero notificaciones externas automáticas", "SIN COBERTURA",
                     "24/7", "ControlBot#20", "#242/B", "#122"):
            with self.subTest(term=term):
                self.assertIn(term.lower(), text.lower())
        self.assertIn("no ejecutar check-in en segundo plano", text.lower())
        self.assertIn("no funcionan por este runbook", text.lower())


if __name__ == "__main__":
    unittest.main()
