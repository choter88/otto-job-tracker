#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

CURRENT=$(node -p "require('./package.json').version")

# Compute next versions
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
NEXT_MAJOR="$((MAJOR + 1)).0.0"
NEXT_MINOR="${MAJOR}.$((MINOR + 1)).0"
NEXT_PATCH="${MAJOR}.${MINOR}.$((PATCH + 1))"

echo ""
echo "Current version: ${CURRENT}"
echo ""
echo "  [1] major → ${NEXT_MAJOR}"
echo "  [2] minor → ${NEXT_MINOR}"
echo "  [3] patch → ${NEXT_PATCH}"
echo "  [4] keep  → ${CURRENT}"
echo ""
read -rp "Choose [1/2/3/4]: " CHOICE

case "$CHOICE" in
  1) BUMP="major"; NEW_VERSION="$NEXT_MAJOR" ;;
  2) BUMP="minor"; NEW_VERSION="$NEXT_MINOR" ;;
  3) BUMP="patch"; NEW_VERSION="$NEXT_PATCH" ;;
  4) NEW_VERSION="$CURRENT" ;;
  *) echo "Invalid choice"; exit 1 ;;
esac

if [[ "$CHOICE" != "4" ]]; then
  echo ""
  echo "Bumping to v${NEW_VERSION}..."
  npm version "$BUMP" --no-git-tag-version > /dev/null
  echo "  ✓ Updated package.json to ${NEW_VERSION}"
  git add package.json package-lock.json 2>/dev/null || git add package.json
  git commit -m "v${NEW_VERSION}" > /dev/null
  echo "  ✓ Committed: v${NEW_VERSION}"
else
  echo ""
  echo "Keeping v${CURRENT}"

  TAG="v${CURRENT}"
  # Clean up existing tag so we can re-tag at the current commit
  if git rev-parse "${TAG}" >/dev/null 2>&1; then
    echo "  Deleting existing local tag ${TAG}..."
    git tag -d "${TAG}" > /dev/null
  fi
  if git ls-remote --tags origin "${TAG}" 2>/dev/null | grep -q "${TAG}"; then
    echo "  Deleting existing remote tag ${TAG}..."
    git push origin ":refs/tags/${TAG}" > /dev/null 2>&1 || true
  fi
fi

TAG="v${NEW_VERSION}"

echo ""
echo "Ready to release ${TAG}."
echo ""
echo "  [A] Push tag to trigger GitHub Actions release (recommended)"
echo "  [B] Manual build (local scripts)"
echo ""
read -rp "Choose [A/B]: " RELEASE_CHOICE

case "$RELEASE_CHOICE" in
  [Aa])
    echo ""
    echo "Creating tag ${TAG} and pushing..."
    git tag "${TAG}"
    git push origin main --tags
    echo "  ✓ Tag ${TAG} pushed — GitHub Actions will build and publish the release."
    echo ""
    echo "Monitor the workflow at:"
    echo "  https://github.com/choter88/otto-job-tracker/actions"
    ;;
  [Bb])
    echo ""
    echo "Manual build steps:"
    echo "  1. Build Mac:     npm run release:mac"
    echo "  2. Build Windows: git pull && npm run release:win"
    echo "  3. Upload (Mac):  npm run release:upload"
    echo "  4. Upload (Win):  npm run release:upload"
    ;;
  *)
    echo ""
    echo "Skipped. To trigger the release later:"
    echo "  git tag ${TAG} && git push origin main --tags"
    ;;
esac
