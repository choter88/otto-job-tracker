#!/usr/bin/env bash
set -euo pipefail

PROFILE="${NOTARY_PROFILE:-otto-notary}"
OUT_DIR="release-mac"
VERSION="${npm_package_version:-$(node -p "require('./package.json').version")}"

echo "=== Building web + server bundle ==="
npm run build

rm -rf "${OUT_DIR}"

notarize_dmg() {
  local arch="$1"
  local dmg_path="$2"
  local app_path="$3"

  echo ""
  echo "=== Notarizing ${arch} ==="

  if [[ ! -f "${dmg_path}" ]]; then
    echo "DMG not found: ${dmg_path}"
    return 1
  fi

  if [[ ! -d "${app_path}" ]]; then
    echo "App bundle not found: ${app_path}"
    return 1
  fi

  echo "Verifying code signature on ${app_path}..."
  local sign_info
  sign_info="$(codesign -dv --verbose=4 "${app_path}" 2>&1 || true)"

  if [[ "${sign_info}" == *"Signature=adhoc"* ]]; then
    echo "${sign_info}"
    echo "App is ad-hoc signed. Fix Developer ID signing before notarizing."
    return 1
  fi

  if [[ "${sign_info}" == *"TeamIdentifier=not set"* ]]; then
    echo "${sign_info}"
    echo "TeamIdentifier is not set. Developer ID identity was not applied."
    return 1
  fi

  codesign --verify --deep --strict --verbose=2 "${app_path}"

  echo "Submitting ${dmg_path} to Apple notary service (profile: ${PROFILE})..."
  xcrun notarytool submit "${dmg_path}" -p "${PROFILE}" --wait

  echo "Stapling notarization ticket..."
  xcrun stapler staple "${dmg_path}"
  xcrun stapler validate "${dmg_path}"

  echo "Running Gatekeeper assessment..."
  spctl -a -vv -t open "${dmg_path}"

  echo "Done: ${dmg_path}"
}

echo ""
echo "=== Building macOS ARM (apple silicon) ==="
npx electron-builder --mac --arm64 -c.directories.output="${OUT_DIR}"
ARM_DMG="$(ls -t "${OUT_DIR}"/*-arm64*.dmg 2>/dev/null | head -n 1 || true)"
ARM_APP="$(find "${OUT_DIR}/mac-arm64" -maxdepth 1 -type d -name "*.app" 2>/dev/null | head -n 1 || true)"

echo ""
echo "=== Building macOS x64 (intel) ==="
npx electron-builder --mac --x64 -c.directories.output="${OUT_DIR}"
X64_DMG="$(ls -t "${OUT_DIR}"/*-x64*.dmg 2>/dev/null | head -n 1 || true)"
X64_APP="$(find "${OUT_DIR}/mac" -maxdepth 1 -type d -name "*.app" 2>/dev/null | head -n 1 || true)"

notarize_dmg "arm64" "${ARM_DMG}" "${ARM_APP}"
notarize_dmg "x64"   "${X64_DMG}" "${X64_APP}"

echo ""
echo "=== Release complete ==="
echo "  ARM64: ${ARM_DMG}"
echo "  x64:   ${X64_DMG}"
echo ""
echo "To publish as a GitHub Release:"
echo "  gh release create v${VERSION} ${ARM_DMG} ${X64_DMG} --title \"Otto Tracker v${VERSION}\" --generate-notes"
