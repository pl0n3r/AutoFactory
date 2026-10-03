#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
PROJECT_ROOT="$ROOT/safari"
RESOURCES="$PROJECT_ROOT/ChatGPT Autopilot Local Extension/Resources"
ASSET_LIST="$(mktemp)"
trap 'rm -f "$ASSET_LIST"' EXIT

node - "$ROOT" > "$ASSET_LIST" <<'NODE'
const path = require('node:path');
const root = process.argv[2];
const { declaredExtensionAssets } = require(
  path.join(root, 'scripts', 'verify-extension-assets.cjs')
);
for (const file of declaredExtensionAssets(root)) {
  process.stdout.write(file + '\n');
}
NODE

while IFS= read -r file; do
  mkdir -p "$(dirname "$RESOURCES/$file")"
  cp "$ROOT/$file" "$RESOURCES/$file"
done < "$ASSET_LIST"

node "$ROOT/scripts/verify-extension-assets.cjs"

xcodebuild \
  -project "$PROJECT_ROOT/ChatGPT Autopilot Local.xcodeproj" \
  -scheme "ChatGPT Autopilot Local" \
  -configuration Debug \
  -derivedDataPath "${TMPDIR:-/tmp}/chatgpt-autopilot-derived" \
  CODE_SIGNING_ALLOWED=NO \
  build

print "Safari sincronizado y validado. Abre el proyecto y pulsa Run:"
print "$PROJECT_ROOT/ChatGPT Autopilot Local.xcodeproj"
