#!/usr/bin/env python3
"""Package the complete, SHA-attested Chrome runtime and reversible Safari source."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
DIST = Path(os.environ.get("AUTOFAC_DIST_DIR", str(ROOT / "dist"))).resolve()


def release_assets() -> list[dict[str, object]]:
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True,
        text=True, check=True,
    ).stdout.strip()
    evidence = subprocess.run(
        ["node", "scripts/release-artifact-attestation.cjs", f"v{VERSION}", sha],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    payload = json.loads(evidence.stdout)
    if (
        payload.get("tag") != f"v{VERSION}"
        or payload.get("commit_sha") != sha
        or not isinstance(payload.get("assets"), list)
        or not payload["assets"]
    ):
        raise ValueError("invalid release artifact attestation")
    return payload["assets"]


def verified_source(relative: str, expected_digest: str, expected_size: int) -> Path:
    if (
        not isinstance(relative, str)
        or not relative
        or any(part in ("", ".", "..") for part in relative.split("/"))
        or relative.startswith("/")
        or not isinstance(expected_digest, str)
        or len(expected_digest) != 64
        or type(expected_size) is not int
        or expected_size < 0
    ):
        raise ValueError("invalid attested asset")
    current = ROOT
    for part in relative.split("/"):
        current = current / part
        if current.is_symlink():
            raise ValueError("symlink asset: " + relative)
    if not current.is_file():
        raise ValueError("missing asset: " + relative)
    blob = current.read_bytes()
    if len(blob) != expected_size or hashlib.sha256(blob).hexdigest() != expected_digest:
        raise ValueError("attested asset changed: " + relative)
    return current


def write_safari_source_archive(safari_zip: Path) -> None:
    """Fail closed on symlinks and emit only reversible Safari source."""
    with ZipFile(safari_zip, "w", ZIP_DEFLATED) as archive:
        for source in sorted((ROOT / "safari").rglob("*")):
            if source.is_symlink():
                raise ValueError("symlink in Safari source")
            if source.is_file() and "xcuserdata" not in source.parts and source.suffix != ".xcuserstate":
                archive.write(source, source.relative_to(ROOT))
        for relative in ("build-safari.sh", "README.md", "CHANGELOG.md"):
            source = ROOT / relative
            if source.is_symlink() or not source.is_file():
                raise ValueError("invalid Safari distribution source")
            archive.write(source, relative)


def package() -> tuple[Path, Path]:
    rows = release_assets()
    sources = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("invalid attested asset row")
        relative = row.get("path")
        if relative in sources:
            raise ValueError("duplicate attested asset")
        sources[relative] = verified_source(
            relative, row.get("chrome_sha256"), row.get("size")
        )

    DIST.mkdir(parents=True, exist_ok=True)
    chrome_zip = DIST / f"chatgpt-autopilot-local-chrome-v{VERSION}.zip"
    with ZipFile(chrome_zip, "w", ZIP_DEFLATED) as archive:
        for relative, path in sources.items():
            archive.write(path, relative)

    safari_zip = DIST / f"chatgpt-autopilot-local-safari-source-v{VERSION}.zip"
    write_safari_source_archive(safari_zip)
    return chrome_zip, safari_zip


if __name__ == "__main__":
    chrome_zip, safari_zip = package()
    print(chrome_zip)
    print(safari_zip)
