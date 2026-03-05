#!/usr/bin/env bash
set -euo pipefail

echo "=== Building web + server bundle ==="
npm run build

echo ""
echo "=== Building Windows x64 NSIS installer ==="
npx electron-builder --win --x64

INSTALLER="$(ls -t release/*.exe 2>/dev/null | head -n 1 || true)"

if [[ -z "${INSTALLER}" || ! -f "${INSTALLER}" ]]; then
  echo "No installer found in release/."
  exit 1
fi

echo ""
echo "=== Release complete ==="
echo "  Installer: ${INSTALLER}"
echo ""
echo "Note: For production releases, sign the installer with signtool or"
echo "an EV code-signing certificate before distribution."
