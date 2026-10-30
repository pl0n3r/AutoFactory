#!/usr/bin/env python3
"""Fail-closed verification of an unpacked Chrome/Safari source checkout.

No browser, network, release, or profile access. A trusted commit SHA/version must
be supplied independently; a directory's self-reported version is not authority.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

SAFARI_MANIFEST = "safari/ChatGPT Autopilot Local Extension/Resources/manifest.json"
SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
VERSION_RE = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\Z")


class VerificationError(ValueError):
    pass


def git(root: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, check=False,
        env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"}, timeout=30,
    )
    if result.returncode != 0:
        raise VerificationError("carpeta sin evidencia Git verificable")
    return result.stdout


def tracked_blobs(root: Path) -> dict[str, str]:
    entries = git(root, "ls-tree", "-r", "-z", "--full-tree", "HEAD").split(b"\0")
    result = {}
    for entry in entries:
        if not entry:
            continue
        try:
            metadata, name = entry.split(b"\t", 1)
            mode, kind, oid = metadata.decode("ascii").split()
            relative = name.decode("utf-8", errors="strict")
        except (UnicodeError, ValueError) as exc:
            raise VerificationError("árbol Git malformado") from exc
        if mode not in ("100644", "100755") or kind != "blob" or not SHA_RE.fullmatch(oid):
            raise VerificationError("enlace simbólico o submódulo en la versión")
        if relative in result or not relative or any(p in ("", ".", "..") for p in relative.split("/")):
            raise VerificationError("ruta Git no válida")
        result[relative] = oid
    if not result:
        raise VerificationError("versión sin archivos declarados")
    return result


def disk_files(root: Path) -> dict[str, Path]:
    found = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        parent = Path(directory)
        for name in dirs[:]:
            path = parent / name
            if path.is_symlink():
                raise VerificationError("directorio simbólico no permitido")
            if parent == root and name == ".git":
                dirs.remove(name)
        for name in files:
            path = parent / name
            if parent == root and name == ".git":
                if path.is_symlink():
                    raise VerificationError("metadatos Git simbólicos")
                continue
            if not stat.S_ISREG(path.lstat().st_mode):
                raise VerificationError("archivo no regular o enlace simbólico")
            found[path.relative_to(root).as_posix()] = path
    return found


def verify_folder(folder: Path, expected_sha: str, expected_version: str) -> tuple[str, int]:
    if not SHA_RE.fullmatch(expected_sha) or not VERSION_RE.fullmatch(expected_version):
        raise VerificationError("SHA de 40 hex y versión X.Y.Z son obligatorios")
    if folder.is_symlink() or not folder.is_dir():
        raise VerificationError("carpeta ausente o simbólica")
    root = folder.resolve(strict=True)
    if not (root / ".git").exists():
        raise VerificationError("sin checkout Git: no se puede acreditar el SHA")
    top = Path(git(root, "rev-parse", "--show-toplevel").decode().strip()).resolve()
    if top != root:
        raise VerificationError("seleccione la raíz exacta del checkout")
    observed = git(root, "rev-parse", "HEAD").decode("ascii").strip()
    if observed != expected_sha:
        raise VerificationError("SHA de commit distinto del fijado externamente")
    tracked = tracked_blobs(root)
    actual = disk_files(root)
    if set(actual) != set(tracked):
        raise VerificationError("carpeta alterada: archivo añadido, eliminado o no declarado")
    for relative, path in actual.items():
        if path.read_bytes() != git(root, "cat-file", "blob", tracked[relative]):
            raise VerificationError("carpeta alterada: contenido distinto del commit")
    versions = []
    for relative in ("manifest.json", SAFARI_MANIFEST, "package.json", "package-lock.json"):
        if relative not in actual:
            raise VerificationError("manifiesto obligatorio ausente: " + relative)
        try:
            versions.append(json.loads(actual[relative].read_text(encoding="utf-8"))["version"])
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise VerificationError("manifiesto de versión inválido") from exc
    try:
        lock = json.loads(actual["package-lock.json"].read_text(encoding="utf-8"))
        versions.append(lock["packages"][""]["version"])
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise VerificationError("lock sin versión raíz") from exc
    if any(v != expected_version for v in versions):
        raise VerificationError("versión Chrome/Safari/package/lock distinta")
    return observed, len(tracked)



def verify_published_build(folder: Path, expected_sha: str, expected_version: str,
                           published_tag: str) -> str:
    """Compare a packaged build with independently obtained release identity.

    Does not assert that a caller-supplied tag is published or that a browser
    has loaded the package; the caller must obtain tag/SHA from trusted GitHub.
    """
    if (not SHA_RE.fullmatch(expected_sha) or
            not VERSION_RE.fullmatch(expected_version) or
            published_tag != "v" + expected_version):
        raise VerificationError("etiqueta, SHA o versión esperados inválidos")
    if folder.is_symlink() or not folder.is_dir():
        raise VerificationError("carpeta del build inválida")
    build = folder / "extension-build.json"
    manifest = folder / "manifest.json"
    for path in (build, manifest):
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 2048:
            raise VerificationError("metadatos del build ausentes o inseguros")
    try:
        record = json.loads(build.read_text(encoding="utf-8"))
        chrome = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise VerificationError("metadatos del build ilegibles") from exc
    if (not isinstance(record, dict) or set(record) != {"version", "sha", "tag"}
            or record["sha"] != expected_sha or record["version"] != expected_version
            or record["tag"] != published_tag or not isinstance(chrome, dict)
            or chrome.get("version") != expected_version):
        raise VerificationError("SHA/versión del build distinto de la etiqueta publicada")
    return record["sha"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Verifica SHA y versión antes de cargar una extensión local")
    parser.add_argument("folder", type=Path, help="raíz limpia del checkout de la versión")
    parser.add_argument("--sha", required=True, help="SHA Git esperado, obtenido fuera de la carpeta")
    parser.add_argument("--version", required=True, help="versión esperada X.Y.Z")
    parser.add_argument("--published-tag", help="tag externo verificado, ej. v1.7.38; modo build empaquetado")
    args = parser.parse_args()
    try:
        if args.published_tag is not None:
            sha = verify_published_build(args.folder, args.sha, args.version, args.published_tag)
            total = 1  # Sólo se verifica identidad; no se acredita integridad de todos los blobs.
        else:
            sha, total = verify_folder(args.folder, args.sha, args.version)
    except (VerificationError, OSError, subprocess.TimeoutExpired) as exc:
        print("RECHAZADO: " + str(exc), file=sys.stderr)
        return 1
    if args.published_tag is not None:
        print(f"IDENTIDAD COINCIDE (integridad de blobs y tag remoto no acreditados): "
              f"SHA={sha} versión={args.version} tag={args.published_tag}")
    else:
        print(f"VERIFICADO: carpeta={args.folder} SHA={sha} versión={args.version} archivos={total}; Chrome/Safari")
    return 0


if __name__ == "__main__":
    sys.exit(main())
