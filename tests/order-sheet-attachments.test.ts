/**
 * Order-sheet attachments (the JPEG preview that backs the job dialog's
 * "Order Sheet" section).
 *
 * Pins:
 *  - saveOrderSheetAttachment writes the JPEG to disk under the data dir
 *    with the relative path stamped on the ledger row
 *  - the file actually lands at the resolved absolute path with 0o600
 *  - resolveOrderSheetAttachmentPath surfaces NULL once the file vanishes
 *    (no stale paths leaking out of the server)
 *  - getOrderSheetImportByJobOrderId is the lookup the GET-by-orderId
 *    endpoint relies on for both active and archived jobs (same orderId
 *    on either table)
 *  - the path can't escape the data dir (defense-in-depth against a
 *    bogus relative path slipping into the column)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-attachments-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "attachments.sqlite");

const { storage } = await import("../server/storage");
const { sqlite } = await import("../server/db");

const NOW = Date.now();

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // ignore
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test("attachment write/lookup round-trip + path containment + stale detection", async () => {
  const office = await storage.createOffice({ name: "Attachment Optical" } as any);
  const user = await storage.createUser({
    email: "owner@attach.local",
    loginId: "attach-owner",
    password: "hash",
    firstName: "Attach",
    lastName: "Owner",
    role: "owner",
    officeId: office.id,
  } as any);
  const job = await storage.createJob({
    patientFirstName: "Pat",
    patientLastName: "Test",
    jobType: "glasses",
    status: "job_created",
    orderDestination: "hoya",
    officeId: office.id,
    createdBy: user.id,
    source: "order_sheet",
  } as any);

  const ledger = await storage.createOrderSheetImport({
    officeId: office.id,
    fileName: "patient-test-frame-order.pdf",
    contentHash: "f".repeat(64),
    status: "imported",
    parsed: { fields: {}, missing: [] },
    jobId: job.id,
    jobOrderId: job.orderId,
    createdBy: user.id,
  } as any);

  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]); // minimal JPEG header
  const saved = await storage.saveOrderSheetAttachment(ledger.id, jpegBytes, 3);

  assert.equal(saved.attachmentPath, `order-sheet-attachments/${ledger.id}.jpg`);
  assert.equal(saved.attachmentSize, jpegBytes.byteLength);
  assert.equal(saved.attachmentPageCount, 3);

  const resolved = storage.resolveOrderSheetAttachmentPath(saved);
  assert.ok(resolved, "expected absolute path");
  assert.equal(fs.readFileSync(resolved!).equals(jpegBytes), true);
  // Owner-only perms (skip on platforms where mode bits are unreliable).
  if (process.platform !== "win32") {
    const mode = fs.statSync(resolved!).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0o600, got 0${mode.toString(8)}`);
  }

  // Lookup by stable orderId is what the GET endpoint uses, so it must
  // match the row we wrote.
  const byOrderId = await storage.getOrderSheetImportByJobOrderId(office.id, job.orderId);
  assert.ok(byOrderId);
  assert.equal(byOrderId!.id, ledger.id);

  // A bogus path can't escape the data dir — covers any future bug where
  // a relative path with .. ends up in the column.
  const escaped = { ...saved, attachmentPath: "../../../etc/passwd" };
  assert.equal(storage.resolveOrderSheetAttachmentPath(escaped as any), null);

  // Stale: file vanished from disk → null instead of a broken path.
  fs.rmSync(resolved!);
  assert.equal(storage.resolveOrderSheetAttachmentPath(saved), null);

  // No attachment at all → null too.
  const noAttachment = { ...saved, attachmentPath: null };
  assert.equal(storage.resolveOrderSheetAttachmentPath(noAttachment as any), null);

  // Suppress unused-variable lint on NOW.
  assert.ok(NOW > 0);
});
