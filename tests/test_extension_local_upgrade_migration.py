"""AutoFactory #263 — migración de estado local estrictamente sintética y offline.

Este modelo NO modifica perfiles, datos reales ni almacenamiento de navegador.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SAFARI = ROOT / "safari/ChatGPT Autopilot Local Extension/Resources"
DOC = ROOT / "docs/migracion-estado-local.md"

SCHEMA_V1 = frozenset({"masterEnabled", "delaySeconds", "conversationMode"})
SCHEMA_V2 = SCHEMA_V1 | {"reloadCooldownMinutes", "settingsDefaultVersion"}
FIXTURE_KEYS = SCHEMA_V2 | {"futureSyntheticFlag"}
SENSITIVE = re.compile(r"credential|secret|token|cookie|password|session|authorization|chat|prompt", re.I)


def valid_snapshot(value):
    if not isinstance(value, dict) or len(value) > 32:
        raise ValueError("invalid synthetic snapshot")
    if any(not isinstance(k, str) or not k.isascii() or len(k) > 64 or
           k not in FIXTURE_KEYS or SENSITIVE.search(k) for k in value):
        raise ValueError("untrusted synthetic field")
    if "masterEnabled" in value and type(value["masterEnabled"]) is not bool:
        raise ValueError("invalid enabled state")
    if "delaySeconds" in value and (type(value["delaySeconds"]) is not int or
                                    not 5 <= value["delaySeconds"] <= 3600):
        raise ValueError("invalid delay")
    if "conversationMode" in value and value["conversationMode"] not in ("chat", "work"):
        raise ValueError("invalid mode")
    if "settingsDefaultVersion" in value and (
            type(value["settingsDefaultVersion"]) is not int or
            value["settingsDefaultVersion"] not in (1, 2)):
        raise ValueError("invalid schema version")
    if "reloadCooldownMinutes" in value and (
            type(value["reloadCooldownMinutes"]) is not int or
            not 1 <= value["reloadCooldownMinutes"] <= 120):
        raise ValueError("invalid cooldown")
    if "futureSyntheticFlag" in value and type(value["futureSyntheticFlag"]) is not bool:
        raise ValueError("invalid forward field")
    return deepcopy(value)


def synthetic_copy(source, version):
    """Test-only version negotiation. Never reads or writes browser storage."""
    if version not in (1, 2):
        raise ValueError("unknown schema version")
    copied = valid_snapshot(source)
    if version == 2:
        copied.setdefault("reloadCooldownMinutes", 1)
    # Inert future data is retained in the synthetic snapshot after downgrade;
    # the v1 reader must not activate that field.
    copied["settingsDefaultVersion"] = version
    valid_snapshot(copied)
    return copied


class ExtensionLocalUpgradeMigrationTests(unittest.TestCase):
    def test_inventory_and_chrome_safari_parity(self):
        for filename, keys in {
            "popup.js": ("settingsDefaultVersion", "promptSchemaVersion", "masterEnabled",
                         "factoryControlLanAgentKeyV1"),
            "background.js": ("autopilotRecoveryIncidentsV1", "factoryControlInstanceReceiptsV2"),
            "account-budget.js": ("accountBudgetStateV1", "accountBudgetSnapshotV1",
                                  "factoryAccountBudgetV1")
        }.items():
            chrome = (ROOT / filename).read_bytes()
            safari = (SAFARI / filename).read_bytes()
            self.assertEqual(chrome, safari, filename)
            for key in keys:
                self.assertIn(key.encode(), chrome)
        chrome_storage = (ROOT / "factory-control-chrome-storage.js").read_text(encoding="utf-8")
        self.assertIn("factoryControlProfileCredentialsV1", chrome_storage)
        self.assertIn("factoryControlCommandReceiptsV1", chrome_storage)

    def test_upgrade_restart_downgrade_restart_keeps_synthetic_state(self):
        source = {"masterEnabled": False, "delaySeconds": 15,
                  "conversationMode": "chat", "futureSyntheticFlag": True}
        original = deepcopy(source)
        upgraded = synthetic_copy(source, 2)
        restarted = synthetic_copy(deepcopy(upgraded), 2)
        self.assertEqual(upgraded, restarted)
        self.assertEqual(upgraded["reloadCooldownMinutes"], 1)
        down = synthetic_copy(restarted, 1)
        self.assertEqual(down["settingsDefaultVersion"], 1)
        self.assertEqual(down["masterEnabled"], False)
        self.assertTrue(down["futureSyntheticFlag"])
        self.assertEqual(synthetic_copy(deepcopy(down), 2), upgraded)
        self.assertEqual(source, original)

    def test_malformed_unknown_and_sensitive_fail_closed_non_destructive(self):
        for invalid in (None, [], "corrupt", {"delaySeconds": "0"},
                        {"masterEnabled": "true"}, {"delaySeconds": True},
                        {"conversationMode": "unrecognized"}, {"futureKey": 3},
                        {"token": "fake"}, {"cookie": "fake"},
                        {"chatHistory": "fake"}, {"settingsDefaultVersion": 99},
                        {"reloadCooldownMinutes": -1}):
            with self.subTest(kind=repr(invalid)[:45]):
                preserved = deepcopy(invalid)
                with self.assertRaises(ValueError):
                    synthetic_copy(invalid, 2)
                self.assertEqual(invalid, preserved)
        before = {"masterEnabled": False}
        with self.assertRaises(ValueError):
            synthetic_copy(before, 3)
        self.assertEqual(before, {"masterEnabled": False})

    def test_doc_real_hardware_boundaries_and_no_credentials(self):
        content = DOC.read_text(encoding="utf-8")
        for label in ("Chrome", "Safari", "upgrade", "downgrade", "rollback",
                      "reinicio", "NO es smoke", "hardware real", "No borrar",
                      "credenciales", "factoryControlLanAgentKeyV1",
                      "factoryControlProfileCredentialsV1"):
            self.assertIn(label, content)
        self.assertNotIn("@coderabbitai review", content)


if __name__ == "__main__":
    unittest.main()
