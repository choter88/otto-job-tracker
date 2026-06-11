// Order-sheet folder watcher (desktop side of the automation).
//
// Watches the office's chosen folder for new order-sheet files, hashes
// them, and extracts their text. That's ALL it does — no parsing, no job
// creation, no server calls. The renderer (running under the signed-in
// user's session) pulls pending files from here over IPC and ships them
// to the Host's /api/order-sheets endpoints, which own dedup + parsing +
// the ledger. Split this way:
//
//  - auth & PHI access stay attached to a real signed-in user;
//  - the watcher works identically on Host and Client machines;
//  - when the Host is unreachable, nothing queues anywhere — the files
//    simply remain in the folder (the folder IS the durable backlog) and
//    the renderer retries when the connection returns.
//
// This module is deliberately Electron-free (plain Node APIs only) so it
// can be unit-tested with `node --test` against a temp directory.

import chokidar from "chokidar";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const SUPPORTED_ORDER_SHEET_EXTENSIONS = [".pdf", ".txt", ".text"];

// Anything bigger than this is not an order sheet — skip it instead of
// hashing hundreds of MB (someone pointed the watcher at a media folder).
export const MAX_ORDER_SHEET_BYTES = 25 * 1024 * 1024;

// Temp/in-progress artifacts from browsers, Office, and the OS that must
// never be ingested even when they carry a supported extension.
const IGNORED_BASENAME = /^(?:\.|~\$|Thumbs\.db$|desktop\.ini$)/i;
const IGNORED_SUFFIX = /\.(?:tmp|crdownload|partial|part|download)$/i;

export function isSupportedOrderSheetFile(filePath) {
  const base = path.basename(String(filePath || ""));
  if (!base || IGNORED_BASENAME.test(base) || IGNORED_SUFFIX.test(base)) return false;
  return SUPPORTED_ORDER_SHEET_EXTENSIONS.includes(path.extname(base).toLowerCase());
}

export async function sha256File(filePath) {
  const buffer = await fs.promises.readFile(filePath);
  return { hash: crypto.createHash("sha256").update(buffer).digest("hex"), buffer };
}

// ── Text extraction ────────────────────────────────────────────────────

// Rebuild visual lines from pdf.js text items. PDF text is often a
// patchwork of multi-column form layouts; pdf.js returns items in
// content order which interleaves columns, so we re-group by vertical
// position. Items within Y_TOLERANCE pixels of an existing row's
// baseline join that row — Math.round bucketing alone misses pairs
// where label and value differ in font baseline by a few px (so
// "Order Date:" and "04/28/2025" land on separate lines and never
// pair downstream).
const Y_TOLERANCE_PX = 3;

function linesFromTextContent(content) {
  const items = [];
  for (const item of content.items || []) {
    if (typeof item.str !== "string" || !item.str.trim()) continue;
    items.push({
      y: item.transform?.[5] ?? 0,
      x: item.transform?.[4] ?? 0,
      width: typeof item.width === "number" ? item.width : 0,
      fontSize: Math.abs(item.transform?.[0] ?? 10),
      str: item.str,
    });
  }
  // Highest Y first (PDF origin is bottom-left, so high Y = top of page).
  items.sort((a, b) => b.y - a.y);

  const rows = []; // [{ y, items: [...] }]
  for (const item of items) {
    let row = null;
    let bestDelta = Infinity;
    for (const candidate of rows) {
      const delta = Math.abs(candidate.y - item.y);
      if (delta <= Y_TOLERANCE_PX && delta < bestDelta) {
        bestDelta = delta;
        row = candidate;
      }
    }
    if (row) {
      row.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  // Within a row, sort left-to-right and join. CRUCIAL: when the
  // horizontal gap between items is wider than ~1.5 char widths, insert
  // a TAB instead of a space. That preserves the original column
  // structure (PDF text items are item-per-word for proportional fonts;
  // a wide x-gap = a real column boundary like form labels in column 1
  // and values in column 2) so downstream extractPairs can split on
  // \t+ and find multiple label:value pairs in one visual row.
  return rows.map((row) => {
    const sorted = row.items.sort((a, b) => a.x - b.x);
    const pieces = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const prevEnd = prev.x + (prev.width || 0);
        const gap = cur.x - prevEnd;
        const fontSize = prev.fontSize || cur.fontSize || 10;
        // ~0.5 px per char-width is conservative — only flag genuinely
        // wide column gaps, not the half-em space between words.
        pieces.push(gap > fontSize * 1.2 ? "\t" : " ");
      }
      pieces.push(sorted[i].str);
    }
    return pieces
      .join("")
      .replace(/ {2,}/g, "\t") // any wide whitespace gets canonicalized to tab
      .replace(/\t+/g, "\t")
      .replace(/ +/g, " ")
      .trim();
  });
}

export async function extractOrderSheetText(filePath, preloadedBuffer) {
  const extension = path.extname(filePath).toLowerCase();
  const buffer = preloadedBuffer || (await fs.promises.readFile(filePath));

  if (extension === ".txt" || extension === ".text") {
    return { text: buffer.toString("utf8") };
  }

  if (extension === ".pdf") {
    try {
      // Lazy import: unpdf pulls in a bundled pdf.js build (~1MB) that the
      // app shouldn't pay for at startup.
      const { getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(buffer));
      const lines = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        lines.push(...linesFromTextContent(content));
      }
      return { text: lines.join("\n") };
    } catch (error) {
      return {
        extractError: `Couldn't read this PDF (${error?.message || "unknown error"}). It may be corrupted or password-protected.`,
      };
    }
  }

  return { extractError: `Unsupported file type "${extension}". Save order sheets as PDF or plain text.` };
}

// ── Watcher ────────────────────────────────────────────────────────────

/**
 * @param {object} hooks
 * @param {(pending: Array<object>) => void} [hooks.onPending] fired whenever
 *   the pending-file set changes (new file discovered, file acked/removed).
 * @param {(status: object) => void} [hooks.onStatus] fired on lifecycle
 *   changes (started, stopped, folder missing, watch error).
 * @param {(message: string, error?: unknown) => void} [hooks.log]
 */
export function createOrderSheetWatcher(hooks = {}) {
  const log = hooks.log || (() => {});

  let watcher = null;
  /** @type {Map<string, {hash: string, path: string, fileName: string, fileSize: number, mtimeMs: number}>} */
  const pending = new Map();
  // Tracks in-flight hashing so a chokidar add+change burst for the same
  // path doesn't double-read the file.
  const inFlight = new Set();

  const status = {
    state: "stopped", // stopped | watching | error
    folder: "",
    error: "",
    lastEventAt: 0,
  };

  function emitStatus() {
    try {
      hooks.onStatus?.({ ...status, pendingCount: pending.size });
    } catch {
      // renderer may be gone mid-quit; never let that kill the watcher
    }
  }

  function emitPending() {
    try {
      hooks.onPending?.(getPending());
    } catch {
      // ignore
    }
  }

  function getPending() {
    return [...pending.values()];
  }

  async function handleCandidate(filePath, stats, options) {
    if (!isSupportedOrderSheetFile(filePath)) return;

    let fileStats = stats;
    try {
      if (!fileStats) fileStats = await fs.promises.stat(filePath);
    } catch {
      return; // vanished between event and stat
    }
    if (!fileStats.isFile()) return;
    if (fileStats.size > MAX_ORDER_SHEET_BYTES) {
      log(`[order-sheets] skipping oversized file ${path.basename(filePath)} (${fileStats.size} bytes)`);
      return;
    }

    // "New files only" cutoff. The intent is "did this file appear in
    // the folder before or after the automation turned on?". mtime alone
    // gets the wrong answer when the user drags a previously-downloaded
    // PDF into the folder via Finder — the destination inherits the
    // source's modification time, which can predate enabledAt by days
    // even though the file just "appeared" here moments ago. Use the
    // MOST RECENT of mtime, ctime, and birthtime so any of those three
    // events crossing enabledAt counts the file as new:
    //   - birthtime: when the inode was created at the destination
    //     (set by copy/move on macOS/most Linux filesystems)
    //   - ctime: inode metadata last changed (moved, perms tweaked)
    //   - mtime: content last modified (often inherited on copy)
    if (!options.includeExisting && options.enabledAt) {
      const newestSignal = Math.max(
        fileStats.mtimeMs || 0,
        fileStats.ctimeMs || 0,
        fileStats.birthtimeMs || 0,
      );
      if (newestSignal < options.enabledAt) return;
    }

    const flightKey = `${filePath}:${fileStats.mtimeMs}`;
    if (inFlight.has(flightKey)) return;
    inFlight.add(flightKey);

    try {
      const { hash } = await sha256File(filePath);
      if (pending.has(hash)) return;
      pending.set(hash, {
        hash,
        path: filePath,
        fileName: path.basename(filePath),
        fileSize: fileStats.size,
        mtimeMs: fileStats.mtimeMs,
      });
      status.lastEventAt = Date.now();
      emitPending();
      emitStatus();
    } catch (error) {
      log(`[order-sheets] failed to hash ${filePath}`, error);
    } finally {
      inFlight.delete(flightKey);
    }
  }

  async function start({ folder, includeExisting = false, enabledAt = 0 }) {
    await stop();

    const resolved = String(folder || "").trim();
    if (!resolved) {
      status.state = "error";
      status.folder = "";
      status.error = "No folder selected.";
      emitStatus();
      return getStatus();
    }

    try {
      const stats = await fs.promises.stat(resolved);
      if (!stats.isDirectory()) throw new Error("Not a folder");
    } catch {
      status.state = "error";
      status.folder = resolved;
      status.error = "The watched folder can't be opened. It may have been moved, renamed, or be on a disconnected drive.";
      emitStatus();
      return getStatus();
    }

    const options = { includeExisting: !!includeExisting, enabledAt: Number(enabledAt) || 0 };

    watcher = chokidar.watch(resolved, {
      // Top level only — subfolders are someone's filing system, not ours.
      depth: 0,
      // Scan existing content on start: that's the catch-up pass for files
      // saved while Otto was closed. The mtime cutoff + server-side hash
      // dedup keep it from re-importing anything.
      ignoreInitial: false,
      // Don't fire until the file has stopped growing — EHRs and browsers
      // write PDFs incrementally and a half-written PDF reads as corrupt.
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 250 },
      alwaysStat: true,
    });

    watcher.on("add", (filePath, stats) => void handleCandidate(filePath, stats, options));
    // A re-saved (edited) sheet has new bytes — treat like a new file; the
    // server's hash dedup makes unchanged saves a no-op.
    watcher.on("change", (filePath, stats) => void handleCandidate(filePath, stats, options));
    watcher.on("unlink", (filePath) => {
      for (const [hash, entry] of pending) {
        if (entry.path === filePath) {
          pending.delete(hash);
          emitPending();
          break;
        }
      }
    });
    watcher.on("error", (error) => {
      log("[order-sheets] watcher error", error);
      status.state = "error";
      status.error = `Folder watching hit a problem: ${error?.message || "unknown error"}`;
      emitStatus();
    });

    status.state = "watching";
    status.folder = resolved;
    status.error = "";
    status.lastEventAt = Date.now();
    emitStatus();
    log(`[order-sheets] watching ${resolved}`);
    return getStatus();
  }

  async function stop() {
    if (watcher) {
      const current = watcher;
      watcher = null;
      try {
        await current.close();
      } catch {
        // ignore
      }
    }
    pending.clear();
    status.state = "stopped";
    status.error = "";
    emitStatus();
    emitPending();
  }

  function ack(hash) {
    if (pending.delete(hash)) {
      emitPending();
      emitStatus();
    }
  }

  function getStatus() {
    return { ...status, pendingCount: pending.size };
  }

  return {
    start,
    stop,
    ack,
    getPending,
    getStatus,
    extract: extractOrderSheetText,
  };
}
