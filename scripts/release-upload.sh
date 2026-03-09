#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

echo ""
echo "Release ${TAG}"
echo ""

# Check for artifacts
FILES=()
echo "Found artifacts:"

for f in \
  "release-mac/otto-tracker-mac-arm64.dmg" \
  "release-mac/otto-tracker-mac-x64.dmg" \
  "release-win/otto-tracker-win-x64.exe"; do
  if [[ -f "$f" ]]; then
    echo "  ✓ ${f}"
    FILES+=("$f")
  else
    echo "  ✗ ${f} (not found)"
  fi
done

echo ""

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No artifacts found. Build first with:"
  echo "  npm run release:mac"
  echo "  npm run release:win"
  exit 1
fi

# Check if release already exists
if gh release view "$TAG" > /dev/null 2>&1; then
  echo "Uploading ${#FILES[@]} file(s) to existing release ${TAG}..."
  gh release upload "$TAG" "${FILES[@]}" --clobber
else
  echo "Creating GitHub Release ${TAG} with ${#FILES[@]} file(s)..."
  gh release create "$TAG" "${FILES[@]}" --generate-notes
fi

echo "  ✓ Done"
