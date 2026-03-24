#!/usr/bin/env node
/**
 * Windows release build script.
 *
 * Usage:  npm run release:win
 *
 * Builds the web/server bundle, then produces a Windows x64 NSIS installer
 * in the release-win/ directory.
 *
 * The artifact is named otto-tracker-win-x64.exe (set by electron-builder
 * artifactName in package.json) to match the web app download proxy whitelist.
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";

// Load GH_TOKEN from .env if present.
// electron-builder reads GH_TOKEN to embed it in app-update.yml for private repo auto-update.
try {
  const envPath = join(process.cwd(), ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
} catch {
  // ignore
}

if (!process.env.GH_TOKEN) {
  console.warn("Warning: GH_TOKEN is not set. Auto-update from the private repo will not work.");
  console.warn("Set GH_TOKEN in .env or as an environment variable before running this script.");
}

const OUT_DIR = "release-win";
const EXPECTED_EXE = join(OUT_DIR, "otto-tracker-win-x64.exe");
const EXPECTED_YML = join(OUT_DIR, "latest.yml");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// Read version from package.json
const pkg = JSON.parse(
  (await import("fs")).readFileSync("package.json", "utf-8"),
);
const VERSION = pkg.version || "0.0.0";

// Write the auto-update token into desktop/lib/update-token.js so it gets
// shipped inside the packaged app.  electron-updater needs it at runtime to
// authenticate against the private GitHub repo.
import { writeFileSync } from "fs";
writeFileSync(
  join(process.cwd(), "desktop", "lib", "update-token.js"),
  `// Auto-generated at build time. DO NOT commit.\nexport const UPDATE_TOKEN = ${JSON.stringify(process.env.GH_TOKEN || "")};\n`,
);

console.log("=== Building web + server bundle ===");
run("npm run build");

// Clean previous output
if (existsSync(OUT_DIR)) {
  rmSync(OUT_DIR, { recursive: true, force: true });
}

console.log("");
console.log("=== Building Windows x64 NSIS installer ===");
run(`npx electron-builder --win --x64 -c.directories.output=${OUT_DIR}`);

if (!existsSync(EXPECTED_EXE)) {
  console.error(`Expected installer not found: ${EXPECTED_EXE}`);
  process.exit(1);
}

const ymlFound = existsSync(EXPECTED_YML);

console.log("");
console.log("=== Release complete ===");
console.log(`  Installer: ${EXPECTED_EXE}`);
if (ymlFound) console.log(`  Update manifest: ${EXPECTED_YML}`);
console.log("");
console.log(
  "Note: For production releases, sign the installer with signtool or",
);
console.log("an EV code-signing certificate before distribution.");
console.log("");
console.log("To upload to GitHub Release:");
console.log("  npm run release:upload");
