#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Load GH_TOKEN from .env if present.
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "Warning: GH_TOKEN is not set. Auto-update from the private repo will not work."
fi

OUT_DIR="release-win"
VERSION="${npm_package_version:-$(node -p "require('./package.json').version")}"
EXPECTED_EXE="${OUT_DIR}/otto-tracker-win-x64.exe"
EXPECTED_YML="${OUT_DIR}/latest.yml"

# Write the auto-update token for the packaged app.
echo "// Auto-generated at build time. DO NOT commit." > desktop/lib/update-token.js
echo "export const UPDATE_TOKEN = \"${GH_TOKEN:-}\";" >> desktop/lib/update-token.js

echo "=== Building web + server bundle ==="
npm run build

rm -rf "${OUT_DIR}"

echo ""
echo "=== Building Windows x64 NSIS installer ==="
npx electron-builder --win --x64 -c.directories.output="${OUT_DIR}"

if [[ ! -f "${EXPECTED_EXE}" ]]; then
  echo "Expected installer not found: ${EXPECTED_EXE}"
  exit 1
fi

echo ""
echo "=== Release complete ==="
echo "  Installer: ${EXPECTED_EXE}"
if [[ -f "${EXPECTED_YML}" ]]; then
  echo "  Update manifest: ${EXPECTED_YML}"
fi
echo ""
echo "Note: For production releases, sign the installer with signtool or"
echo "an EV code-signing certificate before distribution."
echo ""
echo "To upload to GitHub Release:"
echo "  npm run release:upload"
