"""Contrato de la identidad visual del popup de ChatGPT Autopilot.

Identidad de operación propia: grafito con ámbar de piloto automático, PLAY verde y STOP rojo planos, sin degradados
ni sombras. El JavaScript solo alterna `.active`, `.paused` y `.selected`; el CSS conserva cada selector que usa.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "popup.html"
MIRROR = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources" / "popup.html"
POPUP_JS = ROOT / "popup.js"
SELECTORS = (".status.active", ".status.paused", ".mode-button.selected", ".start", ".stop", ".card", ".metric",
             ".metrics", ".bar i", ".header", ".control-dock", ".footer-actions", ".mode-picker", ".toggle input")


def luminance(value: str) -> float:
    channels = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(first: str, second: str) -> float:
    high, low = sorted((luminance(first), luminance(second)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def tokens() -> dict[str, str]:
    html = HTML.read_text(encoding="utf-8")
    root = re.search(r":root\{([^}]*)\}", html).group(1)
    return dict(re.findall(r"--([a-z-]+):(#[0-9a-fA-F]{6})", root))


class PopupIdentidadTests(unittest.TestCase):
    def test_every_text_and_status_color_meets_wcag_aa(self) -> None:
        t = tokens()
        for name in ("bg", "panel", "line", "muted", "text", "green", "amber", "red", "ink"):
            self.assertIn(name, t)
        for foreground in ("text", "muted", "green", "amber", "red"):
            for surface in ("bg", "panel"):
                with self.subTest(pair=f"{foreground} sobre {surface}"):
                    self.assertGreaterEqual(contrast(t[foreground], t[surface]), 4.5)
        for background in ("green", "amber", "red"):
            with self.subTest(pair=f"ink sobre {background}"):
                self.assertGreaterEqual(contrast(t["ink"], t[background]), 4.5)

    def test_the_css_keeps_every_selector_the_script_and_tests_rely_on(self) -> None:
        html = HTML.read_text(encoding="utf-8")
        css = html[html.index("<style>"):html.index("</style>")]
        flat = re.sub(r"\s+", " ", css)
        for selector in SELECTORS:
            with self.subTest(selector=selector):
                self.assertIn(selector + "{", flat.replace(" {", "{"))
        self.assertRegex(css, r"\.start:focus-visible\s*,\s*\.stop:focus-visible")
        script = POPUP_JS.read_text(encoding="utf-8")
        for toggled in ("'active'", "'paused'", "'selected'"):
            self.assertIn(toggled, script)

    def test_flat_and_sober_without_gradients_shadows_or_external_resources(self) -> None:
        html = HTML.read_text(encoding="utf-8")
        css = html[html.index("<style>"):html.index("</style>")]
        for forbidden in ("gradient", "box-shadow", "text-shadow", "backdrop-filter", "@import", "http://", "https://",
                          "Inter,"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, css)
        self.assertEqual(len(re.findall(r"<link\b", html)), 0)

    def test_the_popup_stays_small_and_chrome_and_safari_match(self) -> None:
        self.assertLessEqual(len(HTML.read_bytes()), 16384)
        self.assertEqual(HTML.read_bytes(), MIRROR.read_bytes())


if __name__ == "__main__":
    unittest.main()
