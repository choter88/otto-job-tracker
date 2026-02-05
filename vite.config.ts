import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
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
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
