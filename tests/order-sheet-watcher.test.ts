/**
 * Tests for the desktop folder watcher (desktop/lib/order-sheet-watcher.js).
 *
 * The watcher module is deliberately Electron-free so it can run under
 * plain `node --test`: these tests exercise the real chokidar pipeline
 * against a temp directory — discovery, the "new files only" mtime
 * cutoff, hashing/ack bookkeeping — and real text extraction including a
 * generated PDF (which doubles as a regression check that the bundled
 * pdf.js build works under the repo's Node version).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createOrderSheetWatcher,
  extractOrderSheetText,
  isSupportedOrderSheetFile,
} from "../desktop/lib/order-sheet-watcher.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "otto-order-sheets-"));
}

// Small but fully valid single-page PDF (correct xref offsets) with one
// text line per entry — enough for pdf.js to extract real text.
function buildPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = lines.map((l, i) => `BT /F1 11 Tf 50 ${740 - i * 16} Td (${esc(l)}) Tj ET`).join("\n");
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

function waitFor<T>(check: () => T | undefined, timeoutMs = 8000, intervalMs = 50): Promise<T> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      const value = check();
      if (value !== undefined) return resolve(value);
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

test("isSupportedOrderSheetFile filters temp/system/unsupported files", () => {
  assert.equal(isSupportedOrderSheetFile("/x/order.pdf"), true);
  assert.equal(isSupportedOrderSheetFile("/x/order.PDF"), true);
  assert.equal(isSupportedOrderSheetFile("/x/order.txt"), true);
  assert.equal(isSupportedOrderSheetFile("/x/.DS_Store"), false);
  assert.equal(isSupportedOrderSheetFile("/x/.hidden.pdf"), false);
  assert.equal(isSupportedOrderSheetFile("/x/~$temp.pdf"), false);
  assert.equal(isSupportedOrderSheetFile("/x/order.pdf.crdownload"), false);
  assert.equal(isSupportedOrderSheetFile("/x/order.pdf.part"), false);
  assert.equal(isSupportedOrderSheetFile("/x/photo.jpg"), false);
  assert.equal(isSupportedOrderSheetFile("/x/Thumbs.db"), false);
});

test("extractOrderSheetText reads .txt files verbatim", async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, "sheet.txt");
  fs.writeFileSync(file, "Patient: Jane Doe\nLab: Vision Lab\n");
  const result = await extractOrderSheetText(file);
  assert.equal(result.extractError, undefined);
  assert.match(result.text!, /Patient: Jane Doe/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("extractOrderSheetText reconstructs lines from a real PDF", async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, "sheet.pdf");
  fs.writeFileSync(file, buildPdf(["FRAME ORDER", "Patient: Jane Doe", "Lab: Vision Lab"]));
  const result = await extractOrderSheetText(file);
  assert.equal(result.extractError, undefined, result.extractError);
  const lines = result.text!.split("\n");
  assert.deepEqual(lines, ["FRAME ORDER", "Patient: Jane Doe", "Lab: Vision Lab"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("extractOrderSheetText reports unreadable PDFs instead of throwing", async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, "broken.pdf");
  fs.writeFileSync(file, "%PDF-1.4 this is not really a pdf");
  const result = await extractOrderSheetText(file);
  assert.ok(result.extractError, "expected an extractError");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("watcher: discovers new files, honors the enabledAt cutoff, acks", async () => {
  const dir = makeTmpDir();

  // A file that existed BEFORE the automation was enabled — must be
  // skipped when includeExisting=false. The cutoff looks at the
  // newest of mtime/ctime/birthtime, so for "old" to mean old, the
  // file must have been WRITTEN earlier than enabledAt. We achieve
  // this by waiting briefly after writing the file before setting
  // enabledAt to "now".
  const oldFile = path.join(dir, "old-sheet.txt");
  fs.writeFileSync(oldFile, "Patient: Old File");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const enabledAt = Date.now();

  let pendingSnapshot: any[] = [];
  const statuses: string[] = [];
  const watcher = createOrderSheetWatcher({
    onPending: (pending) => {
      pendingSnapshot = pending;
    },
    onStatus: (status) => {
      statuses.push(status.state);
    },
  });

  try {
    const status = await watcher.start({ folder: dir, includeExisting: false, enabledAt });
    assert.equal(status.state, "watching");

    // New file saved after enablement → must surface as pending.
    // (awaitWriteFinish needs the file to sit still for ~2s.)
    const newFile = path.join(dir, "new-sheet.txt");
    fs.writeFileSync(newFile, "Patient: Jane Doe\nLab: Vision Lab\n");

    const entry = await waitFor(() => pendingSnapshot.find((p) => p.fileName === "new-sheet.txt"));
    assert.match(entry.hash, /^[a-f0-9]{64}$/);
    assert.equal(entry.path, newFile);

    // The pre-existing file must NOT be pending.
    assert.equal(
      pendingSnapshot.some((p) => p.fileName === "old-sheet.txt"),
      false,
      "old file leaked past the enabledAt cutoff",
    );

    // Ack removes it.
    watcher.ack(entry.hash);
    assert.equal(watcher.getPending().length, 0);
  } finally {
    await watcher.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("watcher: includeExisting=true imports the backlog too", async () => {
  const dir = makeTmpDir();
  const oldFile = path.join(dir, "backlog-sheet.txt");
  fs.writeFileSync(oldFile, "Patient: Backlog");
  const past = (Date.now() - 60_000) / 1000;
  fs.utimesSync(oldFile, past, past);

  let pendingSnapshot: any[] = [];
  const watcher = createOrderSheetWatcher({
    onPending: (pending) => {
      pendingSnapshot = pending;
    },
  });

  try {
    await watcher.start({ folder: dir, includeExisting: true, enabledAt: Date.now() });
    const entry = await waitFor(() => pendingSnapshot.find((p) => p.fileName === "backlog-sheet.txt"));
    assert.ok(entry);
  } finally {
    await watcher.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("watcher: file copied in with OLD mtime but new ctime still counts as new", async () => {
  // The bug this guards: when a user drags an already-downloaded PDF
  // into the watched folder via Finder, the destination's mtime is
  // INHERITED from the source (often days/weeks old), but ctime and
  // birthtime are set when the inode lands at the destination. Using
  // mtime alone as the cutoff would silently drop these files even
  // though they just "appeared" in the folder.
  const dir = makeTmpDir();
  let pendingSnapshot: any[] = [];
  const watcher = createOrderSheetWatcher({
    onPending: (pending) => {
      pendingSnapshot = pending;
    },
  });

  try {
    await watcher.start({ folder: dir, includeExisting: false, enabledAt: Date.now() });

    // Write a file, then dial its mtime far back into the past to
    // simulate the Finder-drag scenario (preserved source mtime).
    // ctime/birthtime stay at "now" because we can't set them through
    // Node and the inode was just created.
    const draggedFile = path.join(dir, "dragged.txt");
    fs.writeFileSync(draggedFile, "Patient: Just dropped in\nLab: Vision Lab\n");
    const longAgo = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000; // 30 days
    fs.utimesSync(draggedFile, longAgo, longAgo);

    const entry = await waitFor(() => pendingSnapshot.find((p) => p.fileName === "dragged.txt"));
    assert.ok(entry, "file with old mtime but fresh ctime must be discovered");
  } finally {
    await watcher.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("watcher: missing folder reports an error status instead of crashing", async () => {
  const watcher = createOrderSheetWatcher({});
  const status = await watcher.start({
    folder: path.join(os.tmpdir(), "otto-definitely-not-here-" + Date.now()),
    includeExisting: false,
    enabledAt: Date.now(),
  });
  assert.equal(status.state, "error");
  assert.match(status.error, /can't be opened/);
  await watcher.stop();
});
