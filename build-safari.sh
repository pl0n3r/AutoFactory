#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
PROJECT_ROOT="$ROOT/safari"
RESOURCES="$PROJECT_ROOT/ChatGPT Autopilot Local Extension/Resources"

mkdir -p "$RESOURCES/icons"
for file in manifest.json autopilot-core.js learning.js reliability.js content.js popup.html popup.js background.js; do
  cp "$ROOT/$file" "$RESOURCES/$file"
done
for file in icon-16.png icon-32.png icon-48.png icon-64.png icon-128.png; do
  cp "$ROOT/icons/$file" "$RESOURCES/icons/$file"
done

xcodebuild \
  -project "$PROJECT_ROOT/ChatGPT Autopilot Local.xcodeproj" \
  -scheme "ChatGPT Autopilot Local" \
  -configuration Debug \
  -derivedDataPath "${TMPDIR:-/tmp}/chatgpt-autopilot-derived" \
  CODE_SIGNING_ALLOWED=NO \
  build

print "Safari sincronizado y validado. Abre el proyecto y pulsa Run:"
print "$PROJECT_ROOT/ChatGPT Autopilot Local.xcodeproj"
