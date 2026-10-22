"""Regresiones locales de adopción de README Contract v2 para AutoFactory."""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
README = ROOT / "README.md"
METADATA = ROOT / "readme" / "project.json"
WORKFLOW = ROOT / ".github" / "workflows" / "readme-contract.yml"

REQUIRED_METADATA = {"name", "tagline", "role", "phase", "roadmap", "stack"}
FORBIDDEN_OPERATIONAL = {
    "main_sha", "version", "ci", "release", "health", "smoke",
    "quality", "active_issue", "active_pr", "last_release",
}
REQUIRED_SECTIONS = (
    "Operational Cockpit",
    "Work Queue",
    "Qué hace el producto",
    "Arquitectura en 60 segundos",
    "Stack e infraestructura",
    "Ciclo de entrega",
    "Calidad y seguridad",
    "Roadmap y fuentes de verdad",
    "Desarrollo local",
    "Mapa de la fábrica",
)

class ReadmeContractAdoptionTests(unittest.TestCase):
    def readme(self) -> str:
        return README.read_text(encoding="utf-8")

    def test_project_metadata_is_stable_and_complete(self):
        metadata = json.loads(METADATA.read_text(encoding="utf-8"))
        self.assertEqual(set(metadata), REQUIRED_METADATA)
        self.assertFalse(set(metadata) & FORBIDDEN_OPERATIONAL)
        for key in REQUIRED_METADATA:
            self.assertIsInstance(metadata[key], str)
            self.assertTrue(metadata[key].strip(), key)
        self.assertEqual(metadata["phase"], "construction")
        self.assertEqual(metadata["role"], "local/manual tool")

    def test_readme_is_contract_v2_without_unknown_blocks(self):
        readme = self.readme()
        self.assertTrue(readme.startswith("# ChatGPT Autopilot Local"))
        # Hero plus ten ordered sections = eleven contract surfaces.
        positions = []
        for heading in REQUIRED_SECTIONS:
            needle = f"## {heading}"
            self.assertEqual(readme.splitlines().count(needle), 1, heading)
            positions.append(readme.index(needle + "\n"))
        self.assertEqual(positions, sorted(positions))
        self.assertIn("## Instalación y uso", readme)
        self.assertIn("## Log de diagnóstico", readme)
        for forbidden in (
            "UNKNOWN", "factory:status", "factory:progress-readiness",
            "Progress + Readiness", "| main SHA |", "| Readiness |",
        ):
            self.assertNotIn(forbidden, readme)

        cockpit = readme.split("## Operational Cockpit\n", 1)[1].split("\n## ", 1)[0]
        self.assertIn("https://github.com/pl0n3r/AutoFactory/actions/workflows/validate.yml", cockpit)
        self.assertIn("/badge.svg?branch=main", cockpit)
        self.assertIn("https://github.com/pl0n3r/AutoFactory/releases", cockpit)
        self.assertIn("https://img.shields.io/github/v/release/pl0n3r/AutoFactory", cockpit)
        self.assertIn("https://control.condorapp.com.co/", cockpit)
        self.assertNotIn("| Señal | Estado |", cockpit)
        self.assertIn("v1.7.37", cockpit)
        self.assertIn("CI no acredita instalación Chrome/Safari", cockpit)
        self.assertIn("smoke real pendiente", cockpit)
        self.assertIn("issues/122", cockpit)

    def test_readme_v2_separates_release_from_real_smoke(self):
        readme = self.readme()
        self.assertIn("https://github.com/pl0n3r/AutoFactory/releases/tag/v1.7.37", readme)
        self.assertIn("https://github.com/pl0n3r/AutoFactory/issues/122", readme)
        self.assertIn("sin asumir pairing", readme)
        self.assertIn("D-061", readme)

    def test_consumer_workflow_uses_factory_v1(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("uses: pl0n3r/factory/.github/workflows/readme.yml@v1", workflow)
        self.assertIn("readme_path: README.md", workflow)
        self.assertIn("metadata_path: readme/project.json", workflow)
        self.assertIn("permissions:\n  contents: read", workflow)
        self.assertNotIn("@main", workflow)

    def test_work_queue_links_canonical_roadmap(self):
        readme = self.readme()
        queue = readme.split("## Work Queue\n", 1)[1].split("\n## ", 1)[0]
        for lane in ("NOW", "NEXT", "LATER", "BLOCKED"):
            self.assertIn(f"**{lane}:**", queue)
        now = queue.split("**NOW:**", 1)[1].split("\n", 1)[0]
        urls = re.findall(
            r"\((https://github\.com/pl0n3r/AutoFactory/(?:issues|pulls)\?[^)]+)\)",
            now,
        )
        self.assertEqual(len(urls), 2)
        issue_url = next(url for url in urls if "/issues?" in url)
        pr_url = next(url for url in urls if "/pulls?" in url)
        issue_query = parse_qs(urlparse(issue_url).query).get("q", [""])[0]
        pr_query = parse_qs(urlparse(pr_url).query).get("q", [""])[0]
        self.assertIn("is:issue", issue_query.split())
        self.assertIn("is:open", issue_query.split())
        self.assertIn('label:"prioridad: crítica"', issue_query)
        self.assertIn("is:pr", pr_query.split())
        self.assertIn("is:open", pr_query.split())
        self.assertNotIn("https://github.com/pl0n3r/AutoFactory/issues/230", queue,
                         "El propio Issue se cierra con este PR y no puede figurar como NOW")
        next_lane = queue.split("**NEXT:**", 1)[1].split("\n", 1)[0]
        self.assertIn("https://github.com/pl0n3r/AutoFactory/issues/228", next_lane)
        self.assertNotIn("https://github.com/pl0n3r/AutoFactory/issues/226", next_lane,
                         "Una dependencia ya completada no puede figurar en NEXT")
        self.assertIn("https://github.com/pl0n3r/AutoFactory/issues/1", queue)

    def test_factory_map_preserves_roles(self):
        readme = self.readme()
        factory_map = readme.split("## Mapa de la fábrica", 1)[1]
        for expected in (
            "Factory** — governance/kit",
            "ControlBot** — control plane",
            "FactoryRunner** — execution plane",
            "Condor / GrindFlow / BRVTAL** — productos",
            "AutoFactory** — herramienta local/manual",
        ):
            self.assertIn(expected, factory_map)
        self.assertIn("AutoFactory no se fusiona con FactoryRunner", factory_map)

if __name__ == "__main__":
    unittest.main()
