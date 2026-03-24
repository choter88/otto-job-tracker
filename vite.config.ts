import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(repoRoot, "package.json"), "utf-8"));

export default defineConfig({
  plugins: [react()],
  define: {
    // Inject SENTRY_DSN and app version so the renderer can read them via import.meta.env
    "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN || ""),
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version || ""),
  },
  resolve: {
    alias: {
      "@": path.resolve(repoRoot, "client", "src"),
      "@shared": path.resolve(repoRoot, "shared"),
    },
  },
  root: path.resolve(repoRoot, "client"),
  build: {
    outDir: path.resolve(repoRoot, "dist/public"),
    emptyOutDir: true,
    // Generate source maps for Sentry stack trace symbolication.
    // The maps are written to disk but NOT shipped in the app bundle
    // (electron-builder's files config excludes them).
    sourcemap: "hidden",
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
