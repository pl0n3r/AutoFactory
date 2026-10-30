"""#431: isolated, offline contract for passive provider quota evidence.

Fixtures are synthetic saved HTML pages. Never accesses a browser or provider.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
BOGOTA = ZoneInfo("America/Bogota")
FIXED_NOW = int(datetime(2026, 10, 30, 15, 0, tzinfo=timezone.utc).timestamp() * 1000)
NODE_CLASSIFIER = r"""
const fs = require('node:fs');
const { classifyProviderPageSignal } = require('./factory-control-account-state.js');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const output = classifyProviderPageSignal({
  signalCode: payload.code,
  alertText: payload.text
}, () => payload.now);
process.stdout.write(JSON.stringify(output));
"""


class VisibleSignals(HTMLParser):
    """Read only visible alert/status blocks and explicit local login links."""
    VOID = frozenset(("area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"))

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.frames: list[dict] = []
        self.alerts: list[str] = []
        self.login = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.VOID:
            return
        data = dict(attrs)
        parent_hidden = bool(self.frames and self.frames[-1]["hidden"])
        style = (data.get("style") or "").replace(" ", "").lower()
        hidden = (parent_hidden or tag in ("script", "style", "template") or
                  "hidden" in data or data.get("aria-hidden") == "true" or
                  "display:none" in style or "visibility:hidden" in style)
        is_alert = not hidden and (data.get("role") in ("alert", "status") or
                                   data.get("data-testid") == "usage-limit-banner")
        is_login = (not hidden and tag == "a" and
                    data.get("href") in ("/auth/login", "/login"))
        self.frames.append({"tag": tag, "hidden": hidden,
                            "kind": "alert" if is_alert else "login" if is_login else None,
                            "text": []})

    def handle_data(self, data: str) -> None:
        if self.frames and not self.frames[-1]["hidden"]:
            for frame in self.frames:
                if frame["kind"] is not None:
                    frame["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        index = next((i for i in range(len(self.frames) - 1, -1, -1)
                      if self.frames[i]["tag"] == tag), None)
        if index is None:
            return
        for frame in reversed(self.frames[index:]):
            content = " ".join(" ".join(frame["text"]).split())
            if frame["kind"] == "alert" and content:
                self.alerts.append(content)
            if frame["kind"] == "login" and any(word in content.lower() for word in
                                                   ("iniciar sesión", "inicia sesión", "sign in", "log in")):
                self.login = True
        del self.frames[index:]


def signal_from_html(markup: str) -> tuple[str, str | None]:
    if len(markup) > 32_768:
        return "unknown", None
    parser = VisibleSignals()
    try:
        parser.feed(markup)
        parser.close()
    except (ValueError, TypeError):
        return "unknown", None
    if len(parser.alerts) != 1:
        return ("authentication", None) if parser.login and not parser.alerts else ("unknown", None)
    alert = parser.alerts[0]
    normalized = alert.casefold()
    is_limit = ("límite" in normalized and ("alcanzado" in normalized or "llegado" in normalized)) or any(
        term in normalized for term in ("usage limit reached", "reached your usage limit"))
    if parser.login or not is_limit or len(alert) > 500:
        return "unknown", None
    return "rate-limit", alert


def colombia_clock(ms: int | None) -> str | None:
    if ms is None:
        return None
    moment = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(BOGOTA)
    hour = moment.hour % 12 or 12
    meridiem = "a. m." if moment.hour < 12 else "p. m."
    return f"{hour}:{moment.minute:02d} {meridiem}"


def read_saved_snapshot(path: Path, now_ms: int) -> dict:
    """One passive read of a synthetic fixture, one pure local classifier call."""
    observed = colombia_clock(now_ms) if type(now_ms) is int and now_ms >= 0 else None
    result = {"state": "unknown", "resetColombia": None,
              "observedColombia": observed, "retryAllowed": False, "networkRequests": 0}
    if observed is None:
        return result
    try:
        with path.open("r", encoding="utf-8") as fh:
            markup = fh.read(32_769)
        code, alert = signal_from_html(markup)
        if code == "unknown":
            return result
        run = subprocess.run(
            ["node", "-e", NODE_CLASSIFIER],
            input=json.dumps({"code": code, "text": alert, "now": now_ms}),
            text=True, capture_output=True, cwd=ROOT,
            env={**os.environ, "TZ": "America/Bogota"},
            timeout=5, check=False)
        if run.returncode != 0:
            return result
        classified = json.loads(run.stdout)
        state = classified.get("state")
        if state not in ("limit", "requires_login"):
            return result
        result["state"] = state
        if state == "limit":
            reset_at = classified.get("resetAt")
            if type(reset_at) is int and now_ms < reset_at <= now_ms + 7 * 86_400_000:
                result["resetColombia"] = colombia_clock(reset_at)
    except (OSError, ValueError, subprocess.TimeoutExpired, OverflowError):
        return result
    return result


class ObservacionCuotaTests(unittest.TestCase):
    def _fixture(self, directory: str, name: str, html: str) -> Path:
        path = Path(directory) / (name + ".html")
        path.write_text(html, encoding="utf-8")
        return path

    def test_criterio_principal(self) -> None:
        """AC-01: stored HTML: reached limit/reset, signed out, unknown."""
        with tempfile.TemporaryDirectory() as directory:
            limit = self._fixture(directory, "limit", '''<html><main>
<div role="alert">Has alcanzado el límite de uso. Inténtalo de nuevo a las 1:30 p. m.</div>
<article>texto privado que no se debe capturar</article></main></html>''')
            logged_out = self._fixture(directory, "logged-out", '''<html><main>
<a href="/auth/login">Iniciar sesión</a></main></html>''')
            no_signal = self._fixture(directory, "no-signal", '''<html><main>
<article>Mensajes de chat no son señales de cuota</article></main></html>''')
            observed = [read_saved_snapshot(path, FIXED_NOW) for path in
                        (limit, logged_out, no_signal)]
            self.assertEqual([x["state"] for x in observed],
                             ["limit", "requires_login", "unknown"])
            self.assertEqual(observed[0]["resetColombia"], "1:30 p. m.")
            self.assertEqual([x["resetColombia"] for x in observed[1:]], [None, None])
            self.assertTrue(all(x["observedColombia"] == "10:00 a. m." for x in observed))
            self.assertTrue(all(x["retryAllowed"] is False and x["networkRequests"] == 0
                                for x in observed))
            self.assertNotIn("texto privado", json.dumps(observed))

    def test_oculta_y_ambiguo_no_infieren_recuperacion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            hidden = self._fixture(directory, "hidden", '''<html><main>
<script>Has alcanzado el límite</script>
<div role="alert" hidden>Has alcanzado el límite de uso.</div>
<div style="display:none" role="alert">Usage limit reached</div>
<article>Has alcanzado el límite de uso.</article></main></html>''')
            multiple = self._fixture(directory, "multiple", '''<main>
<div role="alert">Usage limit reached. Reset at 1:30 PM</div>
<div role="status">Has alcanzado el límite de uso.</div></main>''')
            contradiction = self._fixture(directory, "contradiction", '''<main>
<div role="alert">Usage limit reached. Reset at 1:30 PM</div>
<a href="/auth/login">Log in</a></main>''')
            for path in (hidden, multiple, contradiction):
                self.assertEqual(read_saved_snapshot(path, FIXED_NOW)["state"], "unknown")

    def test_hora_ambigua_sin_reinicio_inventado(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ambiguous = self._fixture(directory, "ambiguous", '''<main>
<div role="alert">Usage limit reached. Reset at 1:30 PM or 2:00 PM.</div></main>''')
            result = read_saved_snapshot(ambiguous, FIXED_NOW)
            self.assertEqual(result["state"], "limit")
            self.assertIsNone(result["resetColombia"])
            self.assertFalse(result["retryAllowed"])

    def test_entrada_invalida_denegada(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            too_long = self._fixture(directory, "long", "<main>" + "x" * 33_000 + "</main>")
            self.assertEqual(read_saved_snapshot(too_long, FIXED_NOW)["state"], "unknown")
            self.assertEqual(read_saved_snapshot(too_long, -1)["state"], "unknown")
            self.assertEqual(read_saved_snapshot(Path(directory) / "missing.html", FIXED_NOW)["state"], "unknown")


if __name__ == "__main__":
    unittest.main()
