import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = (
    ROOT / "manifest.json",
    ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources" / "manifest.json",
)


def host_covers(pattern: str, origin: str) -> bool:
    """Un patrón de coincidencia de host cubre un origen http si el esquema coincide y el host es «*» o igual."""
    m = re.fullmatch(r"(http|https)://([^/]+)/\*", pattern)
    o = re.fullmatch(r"(http|https)://([^/:]+)(?::\d+)?/\*", origin)
    if not m or not o:
        return False
    scheme, host = m.group(1), m.group(2).split(":")[0]
    return scheme == o.group(1) and (host == "*" or host == o.group(2))


class LanPermissionsManifestTests(unittest.TestCase):
    def test_private_lan_origin_is_requestable_and_other_hosts_stay_denied(self) -> None:
        for path in MANIFESTS:
            manifest = json.loads(path.read_text(encoding="utf-8"))
            optional = manifest["optional_host_permissions"]
            with self.subTest(manifest=str(path.relative_to(ROOT))):
                # Chrome solo deja pedir orígenes declarados como opcionales: una IP de la red local debe estar cubierta.
                for origin in ("http://192.168.40.9:8777/*", "http://10.0.0.5:8777/*", "http://172.16.3.4:8777/*", "http://127.0.0.1:8777/*"):
                    self.assertTrue(any(host_covers(p, origin) for p in optional), origin)
                # No se concede nada al instalar: nada de esto va en los permisos obligatorios.
                self.assertEqual(manifest["host_permissions"], ["https://chatgpt.com/*"])
                self.assertIsNone(manifest.get("optional_permissions"))
        self.assertEqual(
            json.loads(MANIFESTS[0].read_text(encoding="utf-8"))["optional_host_permissions"],
            json.loads(MANIFESTS[1].read_text(encoding="utf-8"))["optional_host_permissions"],
        )

    def test_popup_still_restricts_requests_to_private_ipv4(self) -> None:
        commands = (ROOT / "factory-control-local-commands.js").read_text(encoding="utf-8")
        self.assertIn("private IPv4 origin required", commands)
        self.assertIn("non-private destination forbidden", commands)
        popup = (ROOT / "popup.js").read_text(encoding="utf-8")
        self.assertIn("lanGuard.privateOrigin(", popup)


if __name__ == "__main__":
    unittest.main()
