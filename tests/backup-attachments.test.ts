/**
 * Order-sheet attachment backup/restore/retention round-trip.
 *
 * The attachment PDFs live OUTSIDE the SQLite database, so the backup
 * system has to carry them separately. Each backup pairs its .sqlite
 * with a sidecar directory at <backup-dir>/otto-backup-<ts>-attachments/
 * that holds a snapshot of <data>/order-sheet-attachments/ at backup
 * time. Restore reads the sidecar; retention deletes it alongside the
 * sqlite. Legacy backups without a sidecar still restore cleanly (empty
 * attachments dir; the job dialog falls back to "no preview").
 *
 * These tests pin the round-trip: snapshot bytes survive backup →
 * retention deletes the pair → restore re-populates the live folder
 * from the sidecar → missing sidecar is tolerated.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  copyAttachmentsForBackup,
  enforceBackupRetention,
  getAttachmentSidecarPath,
  removeAttachmentSidecar,
  restoreAttachmentsFromBackup,
} from "../desktop/lib/backup.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writePdf(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, contents, { mode: 0o600 });
}

test("getAttachmentSidecarPath derives a stable, paired name from the backup file", () => {
  const got = getAttachmentSidecarPath("/backups/otto-backup-2026-06-11-080000-123.sqlite");
  assert.equal(got, path.join("/backups", "otto-backup-2026-06-11-080000-123-attachments"));

  // The .db variant some older configs produced must yield the same shape.
  const dbVariant = getAttachmentSidecarPath("/backups/otto-backup-2026-06-11-080000.db");
  assert.equal(dbVariant, path.join("/backups", "otto-backup-2026-06-11-080000-attachments"));
});

test("backup → restore round-trips every attachment byte-for-byte", () => {
  const dataDir = makeTmpDir("otto-data-");
  const backupDir = makeTmpDir("otto-backup-dir-");
  const backupFile = path.join(backupDir, "otto-backup-2026-06-11-080000-001.sqlite");
  fs.writeFileSync(backupFile, "fake sqlite contents"); // stand-in for db.backup() output

  // Three attachments + an unrelated stray file that must NOT be carried.
  const liveAttachDir = path.join(dataDir, "order-sheet-attachments");
  writePdf(path.join(liveAttachDir, "row-1.pdf"), "%PDF-1.4 one\n");
  writePdf(path.join(liveAttachDir, "row-2.pdf"), "%PDF-1.4 two\n");
  writePdf(path.join(liveAttachDir, "row-3.pdf"), "%PDF-1.4 three\n");
  writePdf(path.join(dataDir, "unrelated.txt"), "should not be in sidecar");

  // 1. Backup populates the sidecar with EVERYTHING from the attachments
  //    folder and ignores the rest of the data dir.
  const writtenCount = copyAttachmentsForBackup(backupFile, dataDir);
  assert.equal(writtenCount, 3);

  const sidecar = getAttachmentSidecarPath(backupFile);
  const sidecarFiles = fs.readdirSync(sidecar).sort();
  assert.deepEqual(sidecarFiles, ["row-1.pdf", "row-2.pdf", "row-3.pdf"]);

  // 2. Round-trip: simulate restore into a FRESH data dir. The contents
  //    must match byte-for-byte, perms restored to 0o600.
  const restoredDataDir = makeTmpDir("otto-restored-");
  const restoredCount = restoreAttachmentsFromBackup(backupFile, restoredDataDir);
  assert.equal(restoredCount, 3);

  const restoredAttachDir = path.join(restoredDataDir, "order-sheet-attachments");
  for (const name of sidecarFiles) {
    const original = fs.readFileSync(path.join(liveAttachDir, name));
    const restored = fs.readFileSync(path.join(restoredAttachDir, name));
    assert.equal(restored.equals(original), true, `${name} did not round-trip`);
    if (process.platform !== "win32") {
      const mode = fs.statSync(path.join(restoredAttachDir, name)).mode & 0o777;
      assert.equal(mode, 0o600, `${name} perms not restored (got 0${mode.toString(8)})`);
    }
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.rmSync(restoredDataDir, { recursive: true, force: true });
});

test("restore replaces (not merges) the live attachments folder — point-in-time fidelity", () => {
  const dataDir = makeTmpDir("otto-data-");
  const backupDir = makeTmpDir("otto-backup-dir-");
  const backupFile = path.join(backupDir, "otto-backup-2026-06-11-080000-002.sqlite");
  fs.writeFileSync(backupFile, "sqlite");

  // Snapshot: just one file at backup time.
  writePdf(path.join(dataDir, "order-sheet-attachments", "old-1.pdf"), "old");
  copyAttachmentsForBackup(backupFile, dataDir);

  // Live dir later has DIFFERENT files (post-backup activity). Restore
  // must drop those and revert to the snapshot.
  fs.rmSync(path.join(dataDir, "order-sheet-attachments", "old-1.pdf"));
  writePdf(path.join(dataDir, "order-sheet-attachments", "post-1.pdf"), "post-backup activity");
  writePdf(path.join(dataDir, "order-sheet-attachments", "post-2.pdf"), "more activity");

  restoreAttachmentsFromBackup(backupFile, dataDir);

  const after = fs.readdirSync(path.join(dataDir, "order-sheet-attachments")).sort();
  assert.deepEqual(after, ["old-1.pdf"], "restore must wipe post-backup files, not merge them");

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

test("legacy backups without a sidecar restore cleanly (empty live dir, no throw)", () => {
  const dataDir = makeTmpDir("otto-data-");
  const backupDir = makeTmpDir("otto-backup-dir-");
  const backupFile = path.join(backupDir, "otto-backup-2026-06-11-080000-003.sqlite");
  fs.writeFileSync(backupFile, "legacy sqlite, no sidecar exists");
  // Live attachments dir has files from a prior session that the legacy
  // backup didn't capture — restore should still wipe them so the user
  // doesn't see "broken" attachments whose ledger rows no longer match.
  writePdf(path.join(dataDir, "order-sheet-attachments", "stale.pdf"), "stale");

  const restored = restoreAttachmentsFromBackup(backupFile, dataDir);
  assert.equal(restored, 0);

  const after = fs.readdirSync(path.join(dataDir, "order-sheet-attachments"));
  assert.deepEqual(after, [], "legacy restore must clear the live dir to match the snapshot");

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

test("removeAttachmentSidecar tolerates missing folders (retention sweep called pre-sidecar era)", () => {
  const backupDir = makeTmpDir("otto-backup-dir-");
  const backupFile = path.join(backupDir, "otto-backup-2026-06-11-080000-004.sqlite");
  fs.writeFileSync(backupFile, "sqlite");

  // No sidecar present → no error, no throw.
  assert.doesNotThrow(() => removeAttachmentSidecar(backupFile));

  // Now create and remove one for real.
  const dataDir = makeTmpDir("otto-data-");
  writePdf(path.join(dataDir, "order-sheet-attachments", "x.pdf"), "x");
  copyAttachmentsForBackup(backupFile, dataDir);
  assert.equal(fs.existsSync(getAttachmentSidecarPath(backupFile)), true);

  removeAttachmentSidecar(backupFile);
  assert.equal(fs.existsSync(getAttachmentSidecarPath(backupFile)), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

test("retention prunes the sidecar alongside the .sqlite (no dangling folder)", () => {
  const dataDir = makeTmpDir("otto-data-");
  const backupDir = makeTmpDir("otto-backup-dir-");

  // Two backups: one ancient (~60 days old), one fresh. Retention keeps
  // the recent one and prunes the old. The ancient sidecar must go with
  // its .sqlite or we leak attachment bytes forever.
  const ancient = path.join(backupDir, "otto-backup-2026-04-12-080000-001.sqlite");
  const recent = path.join(backupDir, "otto-backup-2026-06-11-080000-001.sqlite");
  fs.writeFileSync(ancient, "old sqlite");
  fs.writeFileSync(recent, "new sqlite");
  writePdf(path.join(dataDir, "order-sheet-attachments", "a.pdf"), "a");
  copyAttachmentsForBackup(ancient, dataDir);
  copyAttachmentsForBackup(recent, dataDir);

  assert.equal(fs.existsSync(getAttachmentSidecarPath(ancient)), true);
  assert.equal(fs.existsSync(getAttachmentSidecarPath(recent)), true);

  enforceBackupRetention(backupDir);

  // Ancient sqlite AND its sidecar are gone; recent pair survives.
  assert.equal(fs.existsSync(ancient), false, "ancient .sqlite should be pruned");
  assert.equal(fs.existsSync(getAttachmentSidecarPath(ancient)), false, "ancient sidecar should be pruned");
  assert.equal(fs.existsSync(recent), true, "recent .sqlite must survive");
  assert.equal(fs.existsSync(getAttachmentSidecarPath(recent)), true, "recent sidecar must survive");

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

test("empty live attachments folder skips the sidecar entirely", () => {
  const dataDir = makeTmpDir("otto-data-");
  const backupDir = makeTmpDir("otto-backup-dir-");
  const backupFile = path.join(backupDir, "otto-backup-2026-06-11-080000-005.sqlite");
  fs.writeFileSync(backupFile, "sqlite");

  // No attachments dir at all → 0 files, no sidecar created.
  const count = copyAttachmentsForBackup(backupFile, dataDir);
  assert.equal(count, 0);
  assert.equal(fs.existsSync(getAttachmentSidecarPath(backupFile)), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});
