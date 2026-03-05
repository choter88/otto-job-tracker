#!/usr/bin/env node
/**
 * Windows release build script.
 *
 * Usage:  npm run release:win
 *
 * Builds the web/server bundle, then produces a Windows x64 NSIS installer
 * in the release-win/ directory.
 */
import { execSync } from "child_process";
import { readdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const OUT_DIR = "release-win";

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function findFile(dir, ext) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(ext));
  return files.length > 0 ? join(dir, files[0]) : null;
}

// Read version from package.json
const pkg = JSON.parse(
  (await import("fs")).readFileSync("package.json", "utf-8"),
);
const VERSION = pkg.version || "0.0.0";

console.log("=== Building web + server bundle ===");
run("npm run build");

// Clean previous output
if (existsSync(OUT_DIR)) {
  rmSync(OUT_DIR, { recursive: true, force: true });
}

console.log("");
console.log("=== Building Windows x64 NSIS installer ===");
run(`npx electron-builder --win --x64 -c.directories.output=${OUT_DIR}`);

const installer = findFile(OUT_DIR, ".exe");

if (!installer) {
  console.error(`No installer found in ${OUT_DIR}/.`);
  process.exit(1);
}

console.log("");
console.log("=== Release complete ===");
console.log(`  Installer: ${installer}`);
console.log("");
console.log(
  "Note: For production releases, sign the installer with signtool or",
);
console.log("an EV code-signing certificate before distribution.");
console.log("");
console.log("To publish as a GitHub Release:");
console.log(
  `  gh release create v${VERSION} "${installer}" --title "Otto Tracker v${VERSION} (Windows)" --generate-notes`,
);
