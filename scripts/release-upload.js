import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const TAG = `v${version}`;

// Release channel: versions with a non-zero patch (e.g. v1.3.1, v1.3.12)
// are marked as pre-release (test builds). Only versions ending in .0
// (e.g. v1.3.0) are stable releases that reach production users.
//
// Override with: npm run release:upload -- --prerelease / --stable
const patchVersion = parseInt(version.split(".")[2] || "0", 10);
const cliArg = process.argv.find(a => a === "--prerelease" || a === "--stable");
const isPrerelease = cliArg === "--prerelease" ? true
  : cliArg === "--stable" ? false
  : patchVersion !== 0;

const channelLabel = isPrerelease ? "PRE-RELEASE (test)" : "STABLE (production)";
console.log(`\nRelease ${TAG}  [${channelLabel}]\n`);

const ARTIFACTS = [
  // Mac: DMG (manual install) + ZIP (auto-update) + update manifest
  "release-mac/otto-tracker-mac-arm64.dmg",
  "release-mac/otto-tracker-mac-arm64.zip",
  "release-mac/otto-tracker-mac-x64.dmg",
  "release-mac/otto-tracker-mac-x64.zip",
  "release-mac/latest-mac.yml",
  // Windows: NSIS installer + update manifest
  "release-win/otto-tracker-win-x64.exe",
  "release-win/latest.yml",
];

console.log("Found artifacts:");
const found = [];
for (const f of ARTIFACTS) {
  if (existsSync(f)) {
    console.log(`  ✓ ${f}`);
    found.push(f);
  } else {
    console.log(`  ✗ ${f} (not found)`);
  }
}

console.log();

if (found.length === 0) {
  console.log("No artifacts found. Build first with:");
  console.log("  npm run release:mac");
  console.log("  npm run release:win");
  process.exit(1);
}

const files = found.join(" ");

const prereleaseFlag = isPrerelease ? "--prerelease" : "";

try {
  execSync(`gh release view ${TAG}`, { stdio: "ignore" });
  console.log(`Uploading ${found.length} file(s) to existing release ${TAG}...`);
  execSync(`gh release upload ${TAG} ${files} --clobber`, { stdio: "inherit" });
  // Update pre-release flag on existing release
  if (isPrerelease) {
    execSync(`gh release edit ${TAG} --prerelease`, { stdio: "inherit" });
  } else {
    execSync(`gh release edit ${TAG} --prerelease=false`, { stdio: "inherit" });
  }
} catch {
  console.log(`Creating GitHub Release ${TAG} with ${found.length} file(s)...`);
  execSync(`gh release create ${TAG} ${files} --generate-notes ${prereleaseFlag}`.trim(), { stdio: "inherit" });
}

console.log("  ✓ Done");
