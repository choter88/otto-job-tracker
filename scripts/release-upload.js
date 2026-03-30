import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const TAG = `v${version}`;

console.log(`\nRelease ${TAG}\n`);

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

try {
  execSync(`gh release view ${TAG}`, { stdio: "ignore" });
  console.log(`Uploading ${found.length} file(s) to existing release ${TAG}...`);
  execSync(`gh release upload ${TAG} ${files} --clobber`, { stdio: "inherit" });
} catch {
  console.log(`Creating DRAFT release ${TAG} with ${found.length} file(s)...`);
  execSync(`gh release create ${TAG} ${files} --generate-notes --draft`, { stdio: "inherit" });
}

console.log("  ✓ Done");
console.log("");
console.log("  Release is a DRAFT — invisible to users until promoted.");
console.log(`  To publish:  gh release edit ${TAG} --draft=false --latest`);
