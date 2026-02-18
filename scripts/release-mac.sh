#!/usr/bin/env bash
set -euo pipefail

PROFILE="${NOTARY_PROFILE:-otto-notary}"
APP_PATH="${APP_PATH:-}"
DMG_PATH="${DMG_PATH:-}"

echo "Building signed macOS artifacts..."
npm run dist:desktop

if [[ -z "${DMG_PATH}" ]]; then
  DMG_PATH="$(ls -t release/*.dmg 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "${APP_PATH}" ]]; then
  APP_PATH="$(find release -maxdepth 2 -type d -name "*.app" | head -n 1 || true)"
fi

if [[ -z "${DMG_PATH}" || ! -f "${DMG_PATH}" ]]; then
  echo "No DMG found in release/."
  exit 1
fi

if [[ ! -d "${APP_PATH}" ]]; then
  echo "App bundle not found in release/. Set APP_PATH explicitly if needed."
  exit 1
fi

echo "Verifying code signature on ${APP_PATH}..."
SIGN_INFO="$(codesign -dv --verbose=4 "${APP_PATH}" 2>&1 || true)"
if [[ "${SIGN_INFO}" == *"Signature=adhoc"* ]]; then
  echo "${SIGN_INFO}"
  echo "App is ad-hoc signed. Fix Developer ID signing before notarizing."
  exit 1
fi

if [[ "${SIGN_INFO}" == *"TeamIdentifier=not set"* ]]; then
  echo "${SIGN_INFO}"
  echo "TeamIdentifier is not set. Developer ID identity was not applied."
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

echo "Submitting ${DMG_PATH} to Apple notary service (profile: ${PROFILE})..."
xcrun notarytool submit "${DMG_PATH}" -p "${PROFILE}" --wait

echo "Stapling notarization ticket..."
xcrun stapler staple "${DMG_PATH}"
xcrun stapler validate "${DMG_PATH}"

echo "Running Gatekeeper assessment..."
spctl -a -vv -t open "${DMG_PATH}"

echo "Done: ${DMG_PATH}"
