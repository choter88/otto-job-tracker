#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Local Mac build — no code signing, no notarization.
# Produces unsigned artifacts for testing before pushing to GitHub Actions.

OUT_DIR="build-mac"
VERSION="${npm_package_version:-$(node -p "require('./package.json').version")}"

echo "=== Building web + server bundle ==="
npm run build

rm -rf "${OUT_DIR}"

# Write an empty update token — auto-update won't work in local builds,
# but the file must exist for the app to start.
echo "// Auto-generated at build time. DO NOT commit." > desktop/lib/update-token.js
echo "export const UPDATE_TOKEN = \"\";" >> desktop/lib/update-token.js

echo ""
echo "=== Building macOS ARM + x64 (unsigned) ==="
CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder --mac --arm64 --x64 \
    -c.directories.output="${OUT_DIR}" \
    -c.mac.identity=null

echo ""
echo "=== Local build complete (unsigned) ==="
echo "  ARM64 DMG: ${OUT_DIR}/otto-tracker-mac-arm64.dmg"
echo "  ARM64 ZIP: ${OUT_DIR}/otto-tracker-mac-arm64.zip"
echo "  x64   DMG: ${OUT_DIR}/otto-tracker-mac-x64.dmg"
echo "  x64   ZIP: ${OUT_DIR}/otto-tracker-mac-x64.zip"
echo ""
echo "These are UNSIGNED — macOS will warn on open. For signed builds, use GitHub Actions."
