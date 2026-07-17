#!/usr/bin/env bash
# Renames the prebuilt Electron.app -> TolkovinDev.app with its own bundle
# id, so macOS Privacy & Security panes (Accessibility, Input Monitoring,
# Mic) show a distinct dev entry instead of a generic "Electron" that every
# other Electron app in dev on this machine would also show up as.
# Deliberately named differently from the packaged "Tolkovin.app" product
# (see `npm run package:mac` / build.productName) — same name for both
# caused mix-ups where opening this raw dev runtime from Finder (no "."
# arg) showed Electron's blank default-app screen instead of the real app.
# electron's own postinstall re-extracts a fresh Electron.app on every
# `npm install`, so this must re-run after that (see package.json postinstall).
set -euo pipefail
cd "$(dirname "$0")/../node_modules/electron/dist"

if [ -d "TolkovinDev.app" ] && [ ! -d "Electron.app" ]; then
  echo "TolkovinDev.app already renamed, skipping"
  exit 0
fi

rm -rf TolkovinDev.app
mv Electron.app TolkovinDev.app
mv TolkovinDev.app/Contents/MacOS/Electron TolkovinDev.app/Contents/MacOS/TolkovinDev

PLIST=TolkovinDev.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable TolkovinDev" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName TolkovinDev" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.tolkovin.dev" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string TolkovinDev" "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName TolkovinDev" "$PLIST"

echo "renamed to TolkovinDev.app (com.tolkovin.dev)"
