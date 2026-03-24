import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { ImportTemplate } from "@shared/import-types";

const USER_TEMPLATES_FILE = "import-templates.json";

// Built-in templates bundled with the app source.
// This JSON file is resolved relative to the compiled output; the bundler
// (esbuild / Vite) handles the path via the @shared alias.
import builtInTemplatesJson from "@shared/data/built-in-import-templates.json";

function getDataDir(): string {
  return process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker");
}

function getUserTemplatesPath(): string {
  return path.join(getDataDir(), USER_TEMPLATES_FILE);
}

// ---------------------------------------------------------------------------
// Built-in templates (read-only, shipped with app)
// ---------------------------------------------------------------------------

export function readBuiltInTemplates(): ImportTemplate[] {
  const raw = builtInTemplatesJson as unknown[];
  if (!Array.isArray(raw)) return [];
  return raw.map((t: any) => ({ ...t, type: "built-in" as const }));
}

// ---------------------------------------------------------------------------
// User templates (read/write, stored in userData)
// ---------------------------------------------------------------------------

export function readUserTemplates(): ImportTemplate[] {
  const filePath = getUserTemplatesPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ImportTemplate[];
  } catch {
    return [];
  }
}

function writeUserTemplates(templates: ImportTemplate[]): void {
  const filePath = getUserTemplatesPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(templates, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getAllTemplates(): { builtIn: ImportTemplate[]; user: ImportTemplate[] } {
  return {
    builtIn: readBuiltInTemplates(),
    user: readUserTemplates(),
  };
}

export function createUserTemplate(
  data: Omit<ImportTemplate, "id" | "type" | "createdAt">,
): ImportTemplate {
  const templates = readUserTemplates();
  const template: ImportTemplate = {
    ...data,
    id: randomUUID(),
    type: "user",
    createdAt: new Date().toISOString(),
  };
  templates.push(template);
  writeUserTemplates(templates);
  return template;
}

export function updateUserTemplate(
  id: string,
  updates: Partial<Pick<ImportTemplate, "name" | "ehrSystem" | "jobType" | "fieldMappings" | "statusMappings">>,
): ImportTemplate {
  // Reject attempts to modify built-in templates
  const builtIn = readBuiltInTemplates();
  if (builtIn.some((t) => t.id === id)) {
    throw new Error("Cannot modify a built-in template");
  }

  const templates = readUserTemplates();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error("Template not found");

  templates[idx] = { ...templates[idx], ...updates };
  writeUserTemplates(templates);
  return templates[idx];
}

export function deleteUserTemplate(id: string): void {
  // Reject attempts to delete built-in templates
  const builtIn = readBuiltInTemplates();
  if (builtIn.some((t) => t.id === id)) {
    throw new Error("Cannot delete a built-in template");
  }

  const templates = readUserTemplates();
  const filtered = templates.filter((t) => t.id !== id);
  if (filtered.length === templates.length) {
    throw new Error("Template not found");
  }
  writeUserTemplates(filtered);
}
