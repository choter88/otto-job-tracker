#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="release-win"
VERSION="${npm_package_version:-$(node -p "require('./package.json').version")}"

echo "=== Building web + server bundle ==="
npm run build

rm -rf "${OUT_DIR}"

echo ""
echo "=== Building Windows x64 NSIS installer ==="
npx electron-builder --win --x64 -c.directories.output="${OUT_DIR}"

INSTALLER="$(ls -t "${OUT_DIR}"/*.exe 2>/dev/null | head -n 1 || true)"

if [[ -z "${INSTALLER}" || ! -f "${INSTALLER}" ]]; then
  echo "No installer found in ${OUT_DIR}/."
  exit 1
fi

echo ""
echo "=== Release complete ==="
echo "  Installer: ${INSTALLER}"
echo ""
echo "Note: For production releases, sign the installer with signtool or"
echo "an EV code-signing certificate before distribution."
echo ""
echo "To publish as a GitHub Release:"
echo "  gh release create v${VERSION} ${INSTALLER} --title \"Otto Tracker v${VERSION} (Windows)\" --generate-notes"
