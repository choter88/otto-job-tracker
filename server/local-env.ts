import fs from "fs";
import path from "path";

function parseEnvValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function maybeLoadEnvFile(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;

      let key = trimmed.slice(0, eq).trim();
      if (key.startsWith("export ")) key = key.slice("export ".length).trim();
      if (!key) continue;

      const value = parseEnvValue(trimmed.slice(eq + 1));
      if (typeof process.env[key] === "undefined" || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore env load errors; explicit env vars will still work.
  }
}

export function loadLocalEnv(): void {
  if (process.env.OTTO_DISABLE_LOCAL_ENV === "true") return;

  const explicit = process.env.OTTO_ENV_FILE;
  if (explicit) {
    maybeLoadEnvFile(path.resolve(explicit));
    return;
  }

  // Most dev runs start from the repo root.
  const cwdEnv = path.resolve(process.cwd(), ".env");
  maybeLoadEnvFile(cwdEnv);
}

// Load `.env` automatically for local/dev runs.
loadLocalEnv();
