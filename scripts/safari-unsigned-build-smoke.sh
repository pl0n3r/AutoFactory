#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Safari unsigned build smoke: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 2 ]] || fail 'expected <tag> <commit-sha>'
tag=$1
commit_sha=$2
[[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail 'invalid release tag'
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid commit SHA'

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd "$script_dir/.." && pwd -P)
source_root=${AUTOFAC_SOURCE_ROOT:-$repo_root}
node_bin=${AUTOFAC_NODE_BIN:-node}
xcodebuild_bin=${AUTOFAC_XCODEBUILD_BIN:-xcodebuild}
python_bin=${AUTOFAC_PYTHON_BIN:-python3}
project="$source_root/safari/ChatGPT Autopilot Local.xcodeproj"
attestor="$repo_root/scripts/release-artifact-attestation.cjs"

[[ -d "$source_root" && ! -L "$source_root" ]] || fail 'invalid source root'
[[ -d "$project" && ! -L "$project" ]] || fail 'missing Xcode project'
[[ -f "$attestor" && ! -L "$attestor" ]] || fail 'missing release attestor'

workdir=$(mktemp -d "${TMPDIR:-/tmp}/autofactory-safari-smoke.XXXXXX")
trap 'rm -rf "$workdir"' EXIT
attestation="$workdir/attestation.json"
build_root="$workdir/build"
obj_root="$workdir/obj"

if ! "$node_bin" -e '
const modulePath = process.argv[1];
const sourceRoot = process.argv[2];
const tag = process.argv[3];
const sha = process.argv[4];
const { buildReleaseAttestation } = require(modulePath);
process.stdout.write(JSON.stringify(buildReleaseAttestation(sourceRoot, tag, sha)) + "\n");
' "$attestor" "$source_root" "$tag" "$commit_sha" >"$attestation"; then
  fail 'release attestation failed'
fi

release_version=$("$python_bin" - "$attestation" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
version = payload.get("release_version")
assets = payload.get("assets")
if not isinstance(version, str) or not isinstance(assets, list) or not assets:
    raise SystemExit(1)
print(version)
PY
) || fail 'invalid attestation output'
[[ "$tag" == "v$release_version" ]] || fail 'attestation version mismatch'

mkdir -p "$build_root" "$obj_root"
if ! "$xcodebuild_bin" \
  -project "$project" \
  -target 'ChatGPT Autopilot Local' \
  -configuration Release \
  -sdk macosx \
  "SYMROOT=$build_root" \
  "OBJROOT=$obj_root" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  'CODE_SIGN_IDENTITY=' \
  'DEVELOPMENT_TEAM=' \
  "MARKETING_VERSION=$release_version" \
  build >/dev/null; then
  fail 'xcodebuild failed'
fi

appex="$build_root/Release/ChatGPT Autopilot Local.app/Contents/PlugIns/ChatGPT Autopilot Local Extension.appex"
[[ -d "$appex" && ! -L "$appex" ]] || fail 'built Safari extension missing'

"$python_bin" - "$attestation" "$appex" "$tag" "$commit_sha" <<'PY'
import hashlib
import json
import plistlib
import sys
from pathlib import Path

attestation_path = Path(sys.argv[1])
appex = Path(sys.argv[2])
tag = sys.argv[3]
commit_sha = sys.argv[4]
payload = json.loads(attestation_path.read_text(encoding="utf-8"))
version = payload["release_version"]
resources = appex / "Contents" / "Resources"
info_path = appex / "Contents" / "Info.plist"
if info_path.is_symlink() or not info_path.is_file():
    raise SystemExit("built Info.plist missing")
with info_path.open("rb") as handle:
    info = plistlib.load(handle)
if info.get("CFBundleShortVersionString") != version:
    raise SystemExit("built bundle version mismatch")
verified = 0
for row in payload["assets"]:
    relative = row.get("path")
    expected = row.get("safari_sha256")
    expected_size = row.get("size")
    if not isinstance(relative, str) or not isinstance(expected, str):
        raise SystemExit("invalid attestation asset")
    target = resources.joinpath(*relative.split("/"))
    if target.is_symlink() or not target.is_file():
        raise SystemExit("built attested asset missing")
    data = target.read_bytes()
    if len(data) != expected_size or hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit("built attested asset drift")
    verified += 1
result = {
    "schema_version": 1,
    "status": "green",
    "tag": tag,
    "commit_sha": commit_sha,
    "release_version": version,
    "configuration": "Release",
    "code_signing": "disabled",
    "attestation_sha256": payload.get("attestation_sha256"),
    "assets_verified": verified,
}
print(json.dumps(result, sort_keys=True, separators=(",", ":")))
PY
