"""AutoFactory #329: brechas README-02-02..README-03-03, solo pruebas offline.

Ningún resultado de estas pruebas acredita instalación, bridge, release ni GitHub vivo.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
import json
from pathlib import Path
import re
import unittest
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "UNKNOWN"
OFFLINE = "OFFLINE_CONTRACT"
VERSION = "1.7.38"
CUT = "2026-10-28T17:00:00+00:00"  # reloj fijo, exclusivamente sintético
UNITS = {
    "README-02-02": "Fuente: CHANGELOG.md",
    "README-02-03": "D-061",
    "README-03-01": "NOW: Issues críticos abiertos y PRs abiertos",
    "README-03-02": "El estado actual lo determina GitHub",
    "README-03-03": "NEXT: #228",
}


def matrix_rows(document: str) -> dict[str, tuple[str, ...]]:
    """Exige una única fila completa por ID, sin autoacreditar CUBIERTO."""
    result = {}
    for line in document.splitlines():
        match = re.match(r"^\| (README-\d{2}-\d{2}) · ", line)
        if not match or match.group(1) not in UNITS:
            continue
        key = match.group(1)
        if key in result:
            raise ValueError(f"UNKNOWN: fila duplicada {key}")
        cells = tuple(part.strip() for part in line.strip("|").split("|"))
        if (len(cells) != 5 or cells[0] != f"{key} · README.md"
                or cells[2] != "NO_VERIFICABLE" or "UNKNOWN" not in cells[3]
                or UNITS[key] not in cells[1]):
            raise ValueError(f"UNKNOWN: evidencia incompleta {key}")
        result[key] = cells
    if set(result) != set(UNITS):
        raise ValueError("UNKNOWN: falta una unidad")
    return result


def section(document: str, name: str) -> str | None:
    heading = f"## {name}\n"
    if document.count(heading) != 1:
        return None
    return document.split(heading, 1)[1].split("\n## ", 1)[0]


def release_parity(readme: str, changelog: str, versions: object) -> str:
    """Demuestra paridad de fuentes, no versiones instaladas ni permisos reales."""
    text = section(readme, "Estado de la versión publicada")
    expected = {"chrome", "safari", "package", "lock", "lock_root"}
    if (text is None or type(versions) is not dict or set(versions) != expected
            or any(type(value) is not str or value != VERSION
                   for value in versions.values())
            or f"La versión **{VERSION}**" not in text
            or "Fuente: [CHANGELOG.md](CHANGELOG.md)" not in text
            or "D-061" not in text):
        return UNKNOWN
    if not all(f"## {v} —" in changelog for v in
               ("1.7.38", "1.7.37", "1.7.36")):
        return UNKNOWN
    return OFFLINE


def work_queue_links(readme: str) -> str:
    """La portada debe enlazar la consulta viva, no publicar un inventario fijo."""
    queue = section(readme, "Work Queue")
    if queue is None or not all(part in queue for part in (
        "**NOW:**", "**NEXT:**", "**LATER:**", "**BLOCKED:**",
        "El estado actual lo determina GitHub, no este README",
        "/issues/228", "#226", "reserva propia de Coordinación",
    )):
        return UNKNOWN
    now = queue.split("**NOW:**", 1)[1].split("\n", 1)[0]
    links = re.findall(
        r"\((https://github\.com/pl0n3r/AutoFactory/(?:issues|pulls)\?[^)]+)\)",
        now,
    )
    if len(links) != 2:
        return UNKNOWN
    queries = {urlparse(link).path.rsplit("/", 1)[-1]:
               parse_qs(urlparse(link).query).get("q", [""])[0]
               for link in links}
    issues = queries.get("issues", "")
    prs = queries.get("pulls", "")
    if (not all(x in issues for x in ("is:issue", "is:open",
                                     'label:"prioridad: crítica"'))
            or not all(x in prs for x in ("is:pr", "is:open"))):
        return UNKNOWN
    return OFFLINE


def fixture():
    """Datos exclusivamente simulados; nunca se consultan APIs externas."""
    return {
        "source": "synthetic-github", "observed_at": CUT,
        "issues": [
            {"number": 226, "state": "closed", "reason": "completed", "labels": []},
            {"number": 228, "state": "open", "reason": None,
             "labels": ["estado: reservado"]},
            {"number": 41, "state": "open", "reason": None,
             "labels": ["prioridad: crítica"]},
            {"number": 42, "state": "closed", "reason": "completed",
             "labels": ["prioridad: crítica"]},
        ],
        "pull_requests": [
            {"number": 43, "state": "open", "head_sha": "a" * 40},
            {"number": 44, "state": "closed", "head_sha": "b" * 40},
        ],
        "reservations": [
            {"issue": 228, "owner": "synthetic-owner", "active": True,
             "version": 3, "reservation_id": "synthetic-lease-228"},
        ],
    }


def evaluate_snapshot(snapshot: object, *, now: str = CUT) -> dict | str:
    """Sin inventario sintético completo/fresco se falla cerrado con UNKNOWN."""
    if (type(snapshot) is not dict or set(snapshot) !=
            {"source", "observed_at", "issues", "pull_requests", "reservations"}
            or snapshot.get("source") != "synthetic-github"):
        return UNKNOWN
    try:
        observed = datetime.fromisoformat(snapshot["observed_at"])
        current = datetime.fromisoformat(now)
    except (TypeError, ValueError, KeyError):
        return UNKNOWN
    if (observed.tzinfo is None or current.tzinfo is None
            or observed > current
            or current - observed > timedelta(minutes=5)):
        return UNKNOWN
    issues, prs, leases = (snapshot[key] for key in
                          ("issues", "pull_requests", "reservations"))
    if not all(type(rows) is list for rows in (issues, prs, leases)):
        return UNKNOWN
    issue_ids, pr_ids, lease_ids = set(), set(), set()
    for item in issues:
        if (type(item) is not dict or type(item.get("number")) is not int
                or item["number"] <= 0 or item["number"] in issue_ids
                or item.get("state") not in ("open", "closed")
                or type(item.get("labels")) is not list
                or any(type(label) is not str for label in item["labels"])):
            return UNKNOWN
        issue_ids.add(item["number"])
    for item in prs:
        if (type(item) is not dict or type(item.get("number")) is not int
                or item["number"] <= 0 or item["number"] in pr_ids
                or item.get("state") not in ("open", "closed")
                or type(item.get("head_sha")) is not str
                or not re.fullmatch(r"[a-f0-9]{40}", item["head_sha"])):
            return UNKNOWN
        pr_ids.add(item["number"])
    for item in leases:
        if (type(item) is not dict or type(item.get("issue")) is not int
                or item["issue"] in lease_ids or item.get("version") != 3
                or item.get("active") is not True
                or not isinstance(item.get("reservation_id"), str)
                or not item["reservation_id"].strip()
                or not isinstance(item.get("owner"), str)
                or not item["owner"].strip()):
            return UNKNOWN
        lease_ids.add(item["issue"])
    by_issue = {row["number"]: row for row in issues}
    critical = sorted(row["number"] for row in issues if
                      row["state"] == "open"
                      and "prioridad: crítica" in row["labels"])
    open_prs = sorted(row["number"] for row in prs if row["state"] == "open")
    dependency = by_issue.get(226)
    candidate = by_issue.get(228)
    lease = next((row for row in leases if row["issue"] == 228), None)
    next_228 = UNKNOWN
    if (dependency is not None and dependency["state"] == "closed"
            and dependency.get("reason") == "completed"
            and candidate is not None and candidate["state"] == "open"
            and "estado: reservado" in candidate["labels"]
            and lease is not None):
        next_228 = OFFLINE
    return {"now_critical": critical, "now_prs": open_prs, "next_228": next_228}


def operational_evidence(identifier: str, evidence: object = None) -> str:
    """Datos de prueba/README nunca acreditan una reserva ni instalación real."""
    return UNKNOWN


class BrechasAutofactory22Tests(unittest.TestCase):
    def test_contrato_principal(self):
        """AC-01: cinco IDs, cada uno ejercitando su regresión independiente."""
        rows = matrix_rows(
            (ROOT / "docs/matriz-cobertura.md").read_text(encoding="utf-8")
        )
        self.assertEqual(set(rows), set(UNITS))
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        chrome = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        safari = json.loads((ROOT / "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json").read_text(encoding="utf-8"))
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
        versions = {"chrome": chrome["version"], "safari": safari["version"],
                    "package": package["version"], "lock": lock["version"],
                    "lock_root": lock["packages"][""]["version"]}
        queue = evaluate_snapshot(fixture())
        with self.subTest(id="README-02-02"):
            self.assertEqual(release_parity(readme, changelog, versions), OFFLINE)
            self.assertEqual(rows["README-02-02"][2], "NO_VERIFICABLE")
        with self.subTest(id="README-02-03"):
            self.assertIn("D-061", section(readme, "Estado de la versión publicada"))
            self.assertIn("http://*/*", chrome["optional_host_permissions"])
            self.assertNotIn("http://*/*", chrome["host_permissions"])
            self.assertEqual(
                chrome["optional_host_permissions"],
                safari["optional_host_permissions"],
            )
            self.assertEqual(operational_evidence("README-02-03", versions), UNKNOWN)
        with self.subTest(id="README-03-01"):
            self.assertEqual(work_queue_links(readme), OFFLINE)
            self.assertEqual(queue["now_critical"], [41])
            self.assertEqual(queue["now_prs"], [43])
        with self.subTest(id="README-03-02"):
            changed = fixture()
            changed["issues"][2]["state"] = "closed"
            self.assertEqual(evaluate_snapshot(changed)["now_critical"], [])
            self.assertEqual(queue["now_critical"], [41])
            self.assertEqual(operational_evidence("README-03-02", readme), UNKNOWN)
        with self.subTest(id="README-03-03"):
            self.assertEqual(queue["next_228"], OFFLINE)
            self.assertEqual(operational_evidence("README-03-03", queue), UNKNOWN)

    def test_falla_cerrado(self):
        """AC-02: hechos incompletos, obsoletos o contradictorios → UNKNOWN."""
        for change in ("missing_source", "stale", "duplicate", "missing_dependency",
                       "open_dependency", "missing_lease", "invalid_lease"):
            snapshot = deepcopy(fixture())
            if change == "missing_source":
                snapshot.pop("source")
            elif change == "stale":
                snapshot["observed_at"] = "2026-10-28T16:00:00+00:00"
            elif change == "duplicate":
                snapshot["issues"].append(deepcopy(snapshot["issues"][0]))
            elif change == "missing_dependency":
                snapshot["issues"].pop(0)
            elif change == "open_dependency":
                snapshot["issues"][0]["state"] = "open"
            elif change == "missing_lease":
                snapshot["reservations"].clear()
            else:
                snapshot["reservations"][0]["version"] = 2
            with self.subTest(change=change):
                state = evaluate_snapshot(snapshot)
                if change in ("missing_source", "stale", "duplicate", "invalid_lease"):
                    self.assertEqual(state, UNKNOWN)
                else:
                    self.assertEqual(state["next_228"], UNKNOWN)
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        versions = {key: VERSION for key in
                    ("chrome", "safari", "package", "lock", "lock_root")}
        versions["safari"] = "0.0.0"
        self.assertEqual(release_parity(readme, changelog, versions), UNKNOWN)
        document = (ROOT / "docs/matriz-cobertura.md").read_text(encoding="utf-8")
        row = next(x for x in document.splitlines() if x.startswith("| README-02-02 ·"))
        for bad in (document.replace(row + "\n", "", 1), document + "\n" + row):
            with self.assertRaisesRegex(ValueError, "UNKNOWN"):
                matrix_rows(bad)

    def test_sin_datos_reales(self):
        """AC-03: casos sintéticos, sin red, identidades ni material sensible."""
        sample = fixture()
        self.assertEqual(sample["source"], "synthetic-github")
        self.assertEqual(sorted(x["number"] for x in sample["pull_requests"]), [43, 44])
        serialized = json.dumps(sample)
        for word in ("Bearer ", "access_token", "session_cookie",
                     "conversation_id", "@example", "https://api.github.com"):
            with self.subTest(word=word):
                self.assertNotIn(word, serialized)
        self.assertEqual(operational_evidence("README-02-02", sample), UNKNOWN)

    def test_estados_unknown_explicitos(self):
        """AC-04: la fuente viva no se sustituye por README ni por un fake."""
        rows = matrix_rows(
            (ROOT / "docs/matriz-cobertura.md").read_text(encoding="utf-8")
        )
        for identifier in UNITS:
            with self.subTest(row=identifier):
                self.assertEqual(rows[identifier][2], "NO_VERIFICABLE")
                self.assertIn("UNKNOWN", rows[identifier][3])
                for fake in (None, {}, {"ci": "success"},
                             {"installed": True, "legal": True},
                             {"source": "README", "available": True}):
                    self.assertEqual(operational_evidence(identifier, fake), UNKNOWN)
        self.assertEqual(evaluate_snapshot({"source": "README"}), UNKNOWN)
        future = fixture()
        future["observed_at"] = "2026-10-28T18:00:00+00:00"
        self.assertEqual(evaluate_snapshot(future), UNKNOWN)


if __name__ == "__main__":
    unittest.main()
