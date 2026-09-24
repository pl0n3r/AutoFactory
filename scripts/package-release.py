#!/usr/bin/env python3
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / "manifest.json").read_text())["version"]
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)

chrome_files = [
    "manifest.json", "autopilot-core.js", "learning.js", "reliability.js",
    "content.js", "popup.html", "popup.js", "background.js",
]

chrome_zip = DIST / f"chatgpt-autopilot-local-chrome-v{VERSION}.zip"
with ZipFile(chrome_zip, "w", ZIP_DEFLATED) as archive:
    for name in chrome_files:
        archive.write(ROOT / name, name)
    for path in sorted((ROOT / "icons").glob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(ROOT))

safari_zip = DIST / f"chatgpt-autopilot-local-safari-source-v{VERSION}.zip"
with ZipFile(safari_zip, "w", ZIP_DEFLATED) as archive:
    for path in sorted((ROOT / "safari").rglob("*")):
        if path.is_file() and "xcuserdata" not in path.parts and path.suffix != ".xcuserstate":
            archive.write(path, path.relative_to(ROOT))
    archive.write(ROOT / "build-safari.sh", "build-safari.sh")
    archive.write(ROOT / "README.md", "README.md")
    archive.write(ROOT / "CHANGELOG.md", "CHANGELOG.md")

print(chrome_zip)
print(safari_zip)
