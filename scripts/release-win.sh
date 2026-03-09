#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="release-win"
VERSION="${npm_package_version:-$(node -p "require('./package.json').version")}"
EXPECTED_EXE="${OUT_DIR}/otto-tracker-win-x64.exe"

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
echo ""
echo "Note: For production releases, sign the installer with signtool or"
echo "an EV code-signing certificate before distribution."
echo ""
echo "To publish as a GitHub Release:"
echo "  gh release create v${VERSION} \"${EXPECTED_EXE}\" --title \"Otto Tracker v${VERSION} (Windows)\" --generate-notes"
