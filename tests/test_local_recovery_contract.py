"""AutoFactory #260: synthetic, in-memory preference recovery; no real browser I/O."""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
from pathlib import Path
import re
import unittest

DOC = Path(__file__).resolve().parents[1] / "docs" / "local-recovery.md"
KIND = "autofactory-local-preferences"
ALLOW = frozenset(("language", "theme", "localProgressEnabled", "idleWarningSeconds"))


class InvalidSnapshot(ValueError):
    """Invalid input; never mutate the caller's destination."""


def validate_preferences(p):
    if not isinstance(p, dict) or set(p) != ALLOW:
        raise InvalidSnapshot("invalid preference fields")
    if type(p["language"]) is not str or p["language"] not in ("es", "en"):
        raise InvalidSnapshot("invalid language")
    if type(p["theme"]) is not str or p["theme"] not in ("system", "light", "dark"):
        raise InvalidSnapshot("invalid theme")
    if type(p["localProgressEnabled"]) is not bool:
        raise InvalidSnapshot("invalid boolean")
    t = p["idleWarningSeconds"]
    if type(t) is not int or not (30 <= t <= 3600):
        raise InvalidSnapshot("invalid timeout")


def digest(payload):
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def export_synthetic(source):
    """Projection of approved fields only; ignores non-allowlisted source content."""
    if not isinstance(source, dict):
        raise InvalidSnapshot("invalid source")
    p = {key: source[key] for key in ALLOW if key in source}
    validate_preferences(p)
    envelope = {"kind": KIND, "version": 1, "preferences": copy.deepcopy(p)}
    return {**envelope, "sha256": digest(envelope)}


def validate_snapshot(snapshot):
    if not isinstance(snapshot, dict) or set(snapshot) != {"kind", "version", "preferences", "sha256"}:
        raise InvalidSnapshot("invalid envelope")
    if snapshot["kind"] != KIND or type(snapshot["version"]) is not int or snapshot["version"] != 1:
        raise InvalidSnapshot("invalid version")
    validate_preferences(snapshot["preferences"])
    supplied = snapshot["sha256"]
    if type(supplied) is not str or re.fullmatch("[0-9a-f]{64}", supplied) is None:
        raise InvalidSnapshot("invalid hash format")
    expected = digest({k: snapshot[k] for k in ("kind", "version", "preferences")})
    if not hmac.compare_digest(supplied, expected):
        raise InvalidSnapshot("corrupt snapshot")
    return copy.deepcopy(snapshot["preferences"])


def restore_to_disposable_memory(snapshot, destination):
    """Two-phase in-memory restore; return NEW mapping or reject before changes."""
    preferences = validate_snapshot(snapshot)
    if not isinstance(destination, dict):
        raise InvalidSnapshot("invalid destination")
    for key, value in preferences.items():
        if key in destination:
            if type(destination[key]) is not type(value) or destination[key] != value:
                raise InvalidSnapshot("would overwrite existing preference")
    staged = copy.deepcopy(destination)
    staged.update(preferences)
    return staged


class LocalRecoveryContractTests(unittest.TestCase):
    def setUp(self):
        self.source = {
            "language": "es", "theme": "dark", "localProgressEnabled": True,
            "idleWarningSeconds": 90, "chatText": "synthetic-private-chat",
            "authToken": "synthetic-secret", "conversationUrl": "https://example.invalid/chat",
            "receiptLedger": {"fake": 1}, "remoteState": "fake-online",
        }
        self.doc = DOC.read_text(encoding="utf-8")

    def test_documented_allowlist_and_denylist(self):
        for phrase in (
            "Lista positiva cerrada", "Lista negativa absoluta", "language",
            "theme", "localProgressEnabled", "idleWarningSeconds",
            "30–3600", "chats", "prompts", "credenciales", "tokens",
            "IDs de conversación", "receipt ledger", "pairing",
            "estados de sesión", "autorización humana", "puerta legal",
            "rollback", "NO ACREDITA RECUPERACIÓN REAL",
        ):
            self.assertIn(phrase.casefold(), self.doc.casefold())

    def test_reversible_restore_with_synthetic_profile_and_negative_cases(self):
        previous_source = copy.deepcopy(self.source)
        snapshot = export_synthetic(self.source)
        self.assertEqual(set(snapshot["preferences"]), ALLOW)
        self.assertEqual(self.source, previous_source)
        packed = json.dumps(snapshot)
        for sensitive in ("synthetic-private-chat", "synthetic-secret",
                          "example.invalid", "receiptLedger", "remoteState"):
            self.assertNotIn(sensitive, packed)

        original = {"unrelatedLocalState": "synthetic-existing"}
        restored = restore_to_disposable_memory(snapshot, original)
        self.assertEqual(original, {"unrelatedLocalState": "synthetic-existing"})
        self.assertEqual(restored["theme"], "dark")
        self.assertEqual(restore_to_disposable_memory(snapshot, restored), restored)
        # Rollback discards the restored copy, preserving the original snapshot.
        restored = copy.deepcopy(original)
        self.assertEqual(restored, original)

        invalid = [None, [], "invalid", {}]
        corrupted = copy.deepcopy(snapshot)
        corrupted["preferences"]["theme"] = "light"
        invalid.append(corrupted)
        for key in ("chatText", "authToken", "conversationUrl", "receiptLedger",
                    "remoteSessionState", "prompt"):
            case = copy.deepcopy(snapshot)
            case["preferences"][key] = "fake-sensitive"
            case["sha256"] = digest({k: case[k] for k in ("kind", "version", "preferences")})
            invalid.append(case)
        for field, value in (
            ("language", "person@example.invalid"), ("theme", "custom"),
            ("localProgressEnabled", 1), ("idleWarningSeconds", True),
            ("idleWarningSeconds", 29), ("idleWarningSeconds", 3601),
            ("idleWarningSeconds", 60.5), ("language", {"nested": 1}),
        ):
            case = copy.deepcopy(snapshot)
            case["preferences"][field] = value
            invalid.append(case)
        extra = copy.deepcopy(snapshot)
        extra["conversationId"] = "fake-id"
        invalid.append(extra)
        missing = copy.deepcopy(snapshot)
        del missing["preferences"]["language"]
        invalid.append(missing)
        version = copy.deepcopy(snapshot)
        version["version"] = True
        invalid.append(version)
        for bad in invalid:
            dest = copy.deepcopy(original)
            with self.subTest(bad=str(bad)[:70]):
                with self.assertRaises(InvalidSnapshot):
                    restore_to_disposable_memory(bad, dest)
                self.assertEqual(dest, original)

        for collision in (
            {"theme": "light"}, {"idleWarningSeconds": 91},
            {"localProgressEnabled": 1}, {"language": None},
        ):
            before = copy.deepcopy(collision)
            with self.assertRaises(InvalidSnapshot):
                restore_to_disposable_memory(snapshot, collision)
            self.assertEqual(collision, before)

    def test_no_claim_of_real_restore(self):
        for phrase in (
            "NO ACREDITA RECUPERACIÓN REAL", "No existe en este cambio",
            "destino descartable", "No leer chrome.storage",
            "Chrome ni Safari", "no prueba autenticidad",
            "smoke de instalación", "sin cambios adicionales",
        ):
            self.assertIn(phrase.casefold(), self.doc.casefold())
        self.assertEqual(export_synthetic(self.source)["kind"], KIND)


if __name__ == "__main__":
    unittest.main()
