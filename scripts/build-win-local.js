#!/usr/bin/env node
/**
 * Local Windows build — no code signing.
 * Produces an unsigned installer for testing before pushing to GitHub Actions.
 *
 * Usage:  npm run build:win
 */
import { execSync } from "child_process";
import { existsSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const OUT_DIR = "build-win";
const EXPECTED_EXE = join(OUT_DIR, "otto-tracker-win-x64.exe");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// Write an empty update token — auto-update won't work in local builds,
// but the file must exist for the app to start.
writeFileSync(
  join(process.cwd(), "desktop", "lib", "update-token.js"),
  `// Auto-generated at build time. DO NOT commit.\nexport const UPDATE_TOKEN = "";\n`,
);

console.log("=== Building web + server bundle ===");
run("npm run build");

if (existsSync(OUT_DIR)) {
  rmSync(OUT_DIR, { recursive: true, force: true });
}

console.log("");
console.log("=== Building Windows x64 NSIS installer (unsigned) ===");
run(`npx electron-builder --win --x64 -c.directories.output=${OUT_DIR}`);

if (!existsSync(EXPECTED_EXE)) {
  console.error(`Expected installer not found: ${EXPECTED_EXE}`);
  process.exit(1);
}

console.log("");
console.log("=== Local build complete (unsigned) ===");
console.log(`  Installer: ${EXPECTED_EXE}`);
console.log("");
console.log("This is UNSIGNED — Windows will show SmartScreen warnings. For signed builds, use GitHub Actions.");
