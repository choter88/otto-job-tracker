/**
 * Guard for the no-offline-outbox policy.
 *
 * The offline outbox (queued client mutations replayed when the Host came
 * back) was deliberately removed — see commit "Remove offline outbox —
 * simplify to read-only offline mode". The product rule it encodes:
 * Clients must NOT appear to work while the Host is closed. No queued
 * writes, no replay. Offline means read-only.
 *
 * This test replaces the old tests/local-first-outbox.test.ts (which
 * exercised the removed client/src/lib/offline-outbox module) and fails
 * if anyone reintroduces the module or wires renderer code back up to the
 * desktop outbox IPC bridge. The vestigial desktop-side plumbing
 * (desktop/lib/outbox.js, support-bundle diagnostics) is intentionally
 * out of scope here — the policy is about the renderer's write path.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Renderer source trees: the desktop client and the tablet app.
const RENDERER_DIRS = ["client/src", "tablet/src"];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

// The removed module's exports plus the preload bridge methods that fed
// it. Identifier match (word-boundary) so prose comments that merely
// mention the policy don't trip the guard.
const FORBIDDEN_IDENTIFIERS = /\b(?:enqueueOutboxItem|flushOutbox|listOutboxItems|clearOutboxItems|outboxGet|outboxReplace|outboxClear)\b/;

// Any import/require of an offline-outbox module, under any path.
const FORBIDDEN_IMPORT = /(?:from\s+|import\s*\(|require\s*\()\s*["'][^"']*offline-outbox[^"']*["']/;

function* walkSourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSourceFiles(fullPath);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield fullPath;
    }
  }
}

test("the offline-outbox module stays deleted", () => {
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = path.join(REPO_ROOT, "client/src/lib", `offline-outbox${ext}`);
    assert.equal(
      fs.existsSync(candidate),
      false,
      `${path.relative(REPO_ROOT, candidate)} exists — the offline outbox was deliberately removed; ` +
        "Clients must be read-only while the Host is offline.",
    );
  }
});

test("renderer code never queues offline mutations or touches the outbox bridge", () => {
  const offenders: string[] = [];

  for (const rendererDir of RENDERER_DIRS) {
    const absoluteDir = path.join(REPO_ROOT, rendererDir);
    if (!fs.existsSync(absoluteDir)) continue;

    for (const filePath of walkSourceFiles(absoluteDir)) {
      const source = fs.readFileSync(filePath, "utf-8");
      if (FORBIDDEN_IDENTIFIERS.test(source) || FORBIDDEN_IMPORT.test(source)) {
        offenders.push(path.relative(REPO_ROOT, filePath));
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Renderer file(s) reference the offline outbox: ${offenders.join(", ")}. ` +
      "Offline mode is read-only by design — do not queue or replay client mutations.",
  );
});
