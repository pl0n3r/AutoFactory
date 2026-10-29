"""QA sintético y estático de Chrome/Safari, AutoFactory #264."""
import math
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/calidad-ux-lanzamiento.md"
SAFARI = ROOT / "safari/ChatGPT Autopilot Local Extension/Resources"
FILES = ("popup.html", "popup.js", "background.js", "background-entry.js")
CAPS = {"popup.html": 16384, "popup.js": 40960,
        "background.js": 32768, "background-entry.js": 2048}
SAMPLES = (50, 55, 65, 70, 75, 80, 85, 90, 95, 100,
           100, 105, 110, 115, 120, 125, 130, 140, 150, 165)


def latency_p95(samples):
    if not samples or any(not isinstance(v, (int, float)) or v < 0 for v in samples):
        return math.inf
    return sorted(samples)[math.ceil(0.95 * len(samples)) - 1]


def contrast(fg, bg):
    def luminance(value):
        channels = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        linear = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
                  for x in channels]
        return sum(a * b for a, b in zip(linear, (0.2126, 0.7152, 0.0722)))
    hi, lo = sorted((luminance(fg), luminance(bg)), reverse=True)
    return (hi + .05) / (lo + .05)


def audit(html, sizes, samples, cpu=12, memory=12, history=128,
          safari_html=None):
    bad = []
    if not re.search(r"\.start:focus-visible\s*,\s*\.stop:focus-visible", html):
        bad.append("focus")
    for label in ("prompt", "delay", "model-target", "reasoning-level"):
        if f'<label for="{label}"' not in html:
            bad.append("label:" + label)
    if 'role="status"' not in html:
        bad.append("role")
    def var(name):
        match = re.search(r"--" + name + r":(#[0-9a-fA-F]{6})\b", html)
        return match.group(1) if match else None
    fg, muted, panel = (var(x) for x in ("text", "muted", "panel"))
    if not all((fg, muted, panel)) or min(contrast(fg, panel),
                                           contrast(muted, panel)) < 4.5:
        bad.append("contrast")
    for name, cap in CAPS.items():
        if not isinstance(sizes.get(name), int) or sizes[name] > cap or sizes[name] < 0:
            bad.append("size:" + name)
    if latency_p95(samples) > 200:
        bad.append("latency")
    if cpu < 0 or cpu > 20:
        bad.append("cpu")
    if memory < 0 or memory > 24:
        bad.append("memory")
    if history < 0 or history > 200:
        bad.append("history")
    if safari_html is not None and safari_html != html:
        bad.append("parity")
    return bad


def parse_rows(document):
    header = "| ID | Plataforma | Requisito | Umbral | Estado | Evidencia |"
    separator = "| --- | --- | --- | --- | --- | --- |"
    if document.count(header) != 1 or separator not in document.split(header, 1)[1]:
        raise AssertionError("matriz/encabezado/separador ausente")
    body = document.split(header, 1)[1].split(separator, 1)[1]
    body = body.strip().split("\n\n", 1)[0]
    rows = []
    for line in body.splitlines():
        if not line.startswith("| ") or not line.endswith(" |"):
            raise AssertionError("fila malformada")
        cells = [x.strip() for x in line[1:-1].split("|")]
        if len(cells) != 6:
            raise AssertionError("número inválido de columnas")
        rows.append(cells)
    return rows


class CalidadUxLanzamientoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = DOC.read_text(encoding="utf-8")
        cls.html = (ROOT / "popup.html").read_text(encoding="utf-8")
        cls.mirror = (SAFARI / "popup.html").read_text(encoding="utf-8")
        cls.sizes = {n: len((ROOT / n).read_bytes()) for n in FILES}

    def test_matriz_y_umbrales_reproducibles(self):
        rows = parse_rows(self.doc)
        self.assertGreaterEqual(len(rows), 18)
        self.assertEqual(len(rows), len({r[0] for r in rows}))
        states = {"OFFLINE", "SINTÉTICO", "PENDIENTE_REAL", "BLOQUEADO_LEGAL"}
        self.assertTrue(all(r[4] in states for r in rows))
        for term in ("Teclado", "Foco", "Nombres/roles", "Contraste", "Zoom",
                     "CPU", "memoria", "historial", "p95", "Chrome", "Safari"):
            self.assertIn(term.lower(), self.doc.lower())
        for name in FILES:
            with self.subTest(name=name):
                self.assertLessEqual(self.sizes[name], CAPS[name])
                self.assertEqual((ROOT / name).read_bytes(),
                                 (SAFARI / name).read_bytes())
        self.assertEqual([], audit(self.html, self.sizes, SAMPLES,
                                   safari_html=self.mirror))

    def test_negativos_foco_tamano_y_latencia(self):
        self.assertEqual([], audit(self.html, self.sizes, SAMPLES))
        self.assertIn("focus", audit(
            self.html.replace(".start:focus-visible", ".start:focus-hidden"),
            self.sizes, SAMPLES))
        self.assertIn("label:prompt", audit(
            self.html.replace('<label for="prompt">', '<label>'),
            self.sizes, SAMPLES))
        too_big = dict(self.sizes, **{"popup.html": CAPS["popup.html"] + 1})
        self.assertIn("size:popup.html", audit(self.html, too_big, SAMPLES))
        self.assertIn("latency", audit(self.html, self.sizes, (201,) * 20))
        self.assertIn("cpu", audit(self.html, self.sizes, SAMPLES, cpu=21))
        self.assertIn("memory", audit(self.html, self.sizes, SAMPLES, memory=25))
        self.assertIn("history", audit(self.html, self.sizes, SAMPLES, history=201))
        self.assertIn("parity", audit(self.html, self.sizes, SAMPLES,
                                      safari_html=self.mirror + " "))
        self.assertIn("contrast", audit(
            self.html.replace("--muted:#9aa4b0", "--muted:#333333"),
            self.sizes, SAMPLES))

    def test_deuda_safari_y_limitaciones_reales(self):
        rows = parse_rows(self.doc)
        pending = [r for r in rows if r[4] == "PENDIENTE_REAL"]
        self.assertGreaterEqual(len(pending), 4)
        self.assertTrue(any("Safari" in r[1] for r in pending))
        for term in ("#122", "#242/B", "D-061", "UNKNOWN",
                     "NO es certificación", "NO tiempo real",
                     "NO perfil CPU", "NO heap físico",
                     "arranque frío", "no activa"):
            self.assertIn(term.lower(), self.doc.lower())


if __name__ == "__main__":
    unittest.main()
