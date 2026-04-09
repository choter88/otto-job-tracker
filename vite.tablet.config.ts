import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.resolve(repoRoot, "tablet"),
  base: "/tablet/",
  resolve: {
    alias: {
      "@shared": path.resolve(repoRoot, "shared"),
    },
  },
  build: {
    outDir: path.resolve(repoRoot, "dist/tablet"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
