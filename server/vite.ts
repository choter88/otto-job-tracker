import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { type Server as HttpServer } from "http";
import { type Server as HttpsServer } from "https";
import { nanoid } from "nanoid";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: HttpServer | HttpsServer) {
  const [{ createServer: createViteServer, createLogger }, viteConfigModule] = await Promise.all([
    import("vite"),
    (async () => {
      // Resolve Vite config at runtime so production bundles don't pull in dev-only deps.
      const configPath = path.resolve(__dirname, "..", "vite.config.ts");
      return import(pathToFileURL(configPath).href);
    })(),
  ]);

  const viteConfig = viteConfigModule.default;

  const viteLogger = createLogger();

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  // In dev mode, serve the tablet build if it exists (run `npm run build:tablet` first)
  const devTabletDistPath = path.resolve(__dirname, "..", "dist", "tablet");
  if (fs.existsSync(devTabletDistPath)) {
    app.use("/tablet", express.static(devTabletDistPath));
    app.use(/^\/tablet(?!\/api\/)/, (_req, res) => {
      res.sendFile(path.resolve(devTabletDistPath, "index.html"));
    });
  }

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // ── Tablet SPA (must be registered before the desktop catch-all) ──
  const bundledTabletPath = path.resolve(__dirname, "tablet");
  const devTabletPath = path.resolve(__dirname, "..", "dist", "tablet");
  const tabletDistPath = fs.existsSync(bundledTabletPath) ? bundledTabletPath : devTabletPath;

  if (fs.existsSync(tabletDistPath)) {
    app.use("/tablet", express.static(tabletDistPath));
    // SPA catch-all for tablet routes (skip /tablet/api/ — handled by Express routes)
    app.use(/^\/tablet(?!\/api\/)/, (_req, res) => {
      res.sendFile(path.resolve(tabletDistPath, "index.html"));
    });
  }

  // ── Desktop SPA ──
  const bundledDistPath = path.resolve(__dirname, "public");
  const devDistPath = path.resolve(__dirname, "..", "dist", "public");
  const distPath = fs.existsSync(bundledDistPath) ? bundledDistPath : devDistPath;

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
