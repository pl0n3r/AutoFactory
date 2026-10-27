"""Regresión fail-closed de la matriz de permisos Chrome/Safari (#265).

La prueba es puramente local: no inicia navegadores, no solicita permisos, no usa
datos personales, y verifica las fuentes del repositorio sin llamadas de red.
"""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHROME = ROOT / "manifest.json"
SAFARI = ROOT / "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json"
DOCUMENT = ROOT / "docs/permisos-extension-auditoria.md"

EXPECTED = {
    "permissions": ["activeTab", "storage", "tabs", "alarms"],
    "host_permissions": ["https://chatgpt.com/*"],
    "optional_host_permissions": ["http://127.0.0.1:8777/*", "http://*/*"],
}
EXPECTED_MATCHES = ["https://chatgpt.com/*"]


class PermisosExtensionAuditoriaTests(unittest.TestCase):
    def _load_sources(self):
        chrome = json.loads(CHROME.read_text(encoding="utf-8"))
        safari = json.loads(SAFARI.read_text(encoding="utf-8"))
        doc = DOCUMENT.read_text(encoding="utf-8")
        return chrome, safari, doc

    def _assert_contract(self, chrome, safari):
        self.assertIs(type(chrome), dict, "Manifest Chrome debe ser objeto")
        self.assertIs(type(safari), dict, "Manifest Safari debe ser objeto")
        self.assertEqual(chrome, safari, "Los mirrors Chrome/Safari deben ser idénticos")
        self.assertEqual(chrome.get("manifest_version"), 3)

        for name, expected in EXPECTED.items():
            entries = chrome.get(name)
            self.assertIs(type(entries), list, name + " debe ser una lista")
            self.assertTrue(all(type(item) is str and item for item in entries))
            self.assertEqual(len(entries), len(set(entries)), "Entradas repetidas: " + name)
            self.assertEqual(entries, expected, "Expansión o cambio no revisado en " + name)

        scripts = chrome.get("content_scripts")
        self.assertIs(type(scripts), list)
        self.assertEqual(len(scripts), 1)
        self.assertIs(type(scripts[0]), dict)
        self.assertEqual(scripts[0].get("matches"), EXPECTED_MATCHES)
        self.assertNotIn("http://*/*", chrome["host_permissions"])
        self.assertNotIn("https://*/*", chrome["host_permissions"])

    def test_exact_permission_matrix_and_mirrors(self):
        chrome, safari, doc = self._load_sources()
        self._assert_contract(chrome, safari)
        for group, entries in EXPECTED.items():
            for entry in entries:
                with self.subTest(group=group, entry=entry):
                    self.assertIn("| " + group + " | \`" + entry + "\` |", doc)
        self.assertIn("| content_scripts.matches | \`https://chatgpt.com/*\` |", doc)
        for source in ("popup.js", "background.js", "factory-control-chrome-storage.js"):
            self.assertTrue((ROOT / source).is_file())
            self.assertIn("\`" + source + "\`", doc)
        self.assertIn("tabs.query", (ROOT / "popup.js").read_text(encoding="utf-8"))
        self.assertIn("alarms.create", (ROOT / "background.js").read_text(encoding="utf-8"))

    def test_expansion_and_malformed_manifest_fail_closed(self):
        chrome, safari, _ = self._load_sources()
        self._assert_contract(chrome, safari)
        mutations = [
            ("permisos-extra", lambda a, b: a["permissions"].append("debugger")),
            ("permiso-obligatorio-wildcard", lambda a, b: a["host_permissions"].append("http://*/*")),
            ("host-opcional-extra", lambda a, b: a["optional_host_permissions"].append("https://*/*")),
            ("host-obligatorio-generalizado", lambda a, b: a.__setitem__("host_permissions", ["https://*/*"])),
            ("permissions-sin-lista", lambda a, b: a.__setitem__("permissions", "storage")),
            ("permissions-null", lambda a, b: a.__setitem__("permissions", None)),
            ("permission-repetida", lambda a, b: a["permissions"].append("tabs")),
            ("matches-extra", lambda a, b: a["content_scripts"][0]["matches"].append("http://*/*")),
            ("manifest-v2", lambda a, b: a.__setitem__("manifest_version", 2)),
            ("mirror-desincronizado", lambda a, b: b["permissions"].append("cookies")),
        ]
        for name, mutate in mutations:
            with self.subTest(mutation=name):
                left, right = copy.deepcopy(chrome), copy.deepcopy(safari)
                mutate(left, right)
                with self.assertRaises(AssertionError):
                    self._assert_contract(left, right)
        with self.assertRaises(json.JSONDecodeError):
            json.loads("{invalid")

    def test_documentation_controls_and_no_runtime_changes(self):
        chrome, safari, doc = self._load_sources()
        self._assert_contract(chrome, safari)
        for required in (
            "SUPERFICIE SENSIBLE",
            "http://*/*",
            "no autoriza",
            "no acredita",
            "consentimiento",
            "Chrome y Safari",
            "Archivos de ejecución fuera de alcance",
            "sin modificar las extensiones instaladas",
            "D-061",
            "#122",
            "popup.js",
            "background.js",
            "factory-control-chrome-storage.js",
            "tests/test_permisos_extension_auditoria.py",
        ):
            with self.subTest(required=required):
                self.assertIn(required, doc)
        self.assertTrue(CHROME.is_file())
        self.assertTrue(SAFARI.is_file())
        self.assertTrue(DOCUMENT.is_file())


if __name__ == "__main__":
    unittest.main()
