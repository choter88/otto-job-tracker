/**
 * User-uploaded job attachments (the ATTACHMENTS section of the job
 * dialog — insurance cards, Rx scans, lab receipts, etc.).
 *
 * These are DISTINCT from the auto-imported order sheet and carry a
 * different lifecycle, which these tests pin:
 *  - save writes <data>/job-attachments/<id>.<ext> (0o600) + a row keyed
 *    on the stable jobOrderId
 *  - lookups + path resolution are office-scoped and clamp inside the
 *    data dir (no cross-office reach, no path escape, stale-file → null)
 *  - uploads SURVIVE archive (unlike the order sheet, which is unlinked to
 *    bound storage) — they only die on permanent delete
 *  - deleteJobAttachment / deleteJobAttachmentsByOrderId remove file + row
 *  - orderIdExistsInOffice gates uploads to a real order, active OR
 *    archived, in the caller's own office
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-job-attachments-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "job-attachments.sqlite");

const { storage } = await import("../server/storage");
const { sqlite } = await import("../server/db");

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // ignore
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

async function seedOffice(name: string) {
  const office = await storage.createOffice({ name } as any);
  const user = await storage.createUser({
    email: `owner@${office.id}.local`,
    loginId: `${office.id}-owner`,
    password: "hash",
    firstName: "Owner",
    lastName: "User",
    role: "owner",
    officeId: office.id,
  } as any);
  return { office, user };
}

async function seedJob(officeId: string, createdBy: string, status = "job_created") {
  return storage.createJob({
    patientFirstName: "Pat",
    patientLastName: "Test",
    jobType: "glasses",
    status,
    orderDestination: "hoya",
    officeId,
    createdBy,
    source: "manual",
  } as any);
}

test("save → list → resolve round-trip + perms + path containment + stale detection", async () => {
  const { office, user } = await seedOffice("Attach Round-Trip Optical");
  const job = await seedJob(office.id, user.id);

  const bytes = Buffer.from("insurance-card-bytes");
  const saved = await storage.saveJobAttachment({
    officeId: office.id,
    jobOrderId: job.orderId,
    fileBuffer: bytes,
    fileName: "Insurance Card.png",
    ext: "png",
    mimeType: "image/png",
    createdBy: user.id,
  });

  assert.equal(saved.attachmentPath, `job-attachments/${saved.id}.png`);
  assert.equal(saved.size, bytes.byteLength);
  assert.equal(saved.ext, "png");
  assert.equal(saved.mimeType, "image/png");
  assert.equal(saved.jobOrderId, job.orderId);

  const resolved = storage.resolveJobAttachmentPath(saved);
  assert.ok(resolved, "expected an absolute path");
  assert.equal(fs.readFileSync(resolved!).equals(bytes), true);
  if (process.platform !== "win32") {
    const mode = fs.statSync(resolved!).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0o600, got 0${mode.toString(8)}`);
  }

  // List by stable orderId — what the GET endpoint unions in.
  const list = await storage.getJobAttachmentsByOrderId(office.id, job.orderId);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, saved.id);

  // Path can't escape the data dir.
  const escaped = { ...saved, attachmentPath: "../../../etc/passwd" };
  assert.equal(storage.resolveJobAttachmentPath(escaped as any), null);

  // Stale file vanished → null, not a broken path.
  fs.rmSync(resolved!);
  assert.equal(storage.resolveJobAttachmentPath(saved), null);
});

test("getJobAttachment is office-scoped (no cross-office reach by id)", async () => {
  const a = await seedOffice("Office A Optical");
  const b = await seedOffice("Office B Optical");
  const jobA = await seedJob(a.office.id, a.user.id);

  const saved = await storage.saveJobAttachment({
    officeId: a.office.id,
    jobOrderId: jobA.orderId,
    fileBuffer: Buffer.from("a-bytes"),
    fileName: "scan.pdf",
    ext: "pdf",
    mimeType: "application/pdf",
    createdBy: a.user.id,
  });

  // Same id, wrong office → undefined.
  assert.equal(await storage.getJobAttachment(b.office.id, saved.id), undefined);
  // Correct office → found.
  const found = await storage.getJobAttachment(a.office.id, saved.id);
  assert.ok(found);
  assert.equal(found!.id, saved.id);
});

test("uploads SURVIVE archive (kept with the archived job)", async () => {
  const { office, user } = await seedOffice("Archive Keep Optical");
  const job = await seedJob(office.id, user.id, "completed");

  const saved = await storage.saveJobAttachment({
    officeId: office.id,
    jobOrderId: job.orderId,
    fileBuffer: Buffer.from("rx-scan"),
    fileName: "rx.pdf",
    ext: "pdf",
    mimeType: "application/pdf",
    createdBy: user.id,
  });
  const filePath = storage.resolveJobAttachmentPath(saved);
  assert.ok(filePath && fs.existsSync(filePath));

  // archiveJob calls deleteJob internally — neither may touch uploads.
  await storage.archiveJob(job);
  await storage.deleteJob(job.id);

  // File + row still present, still resolvable by the SAME orderId (which
  // is identical on the archived row).
  assert.equal(fs.existsSync(filePath!), true, "upload file must survive archive");
  const stillThere = await storage.getJobAttachmentsByOrderId(office.id, job.orderId);
  assert.equal(stillThere.length, 1, "upload row must survive archive");
  assert.equal(stillThere[0].id, saved.id);
});

test("deleteJobAttachment removes one upload (file + row), office-scoped", async () => {
  const { office, user } = await seedOffice("Delete One Optical");
  const other = await seedOffice("Bystander Optical");
  const job = await seedJob(office.id, user.id);

  const saved = await storage.saveJobAttachment({
    officeId: office.id,
    jobOrderId: job.orderId,
    fileBuffer: Buffer.from("doc"),
    fileName: "doc.pdf",
    ext: "pdf",
    mimeType: "application/pdf",
    createdBy: user.id,
  });
  const filePath = storage.resolveJobAttachmentPath(saved);

  // Wrong office can't delete it.
  assert.equal(await storage.deleteJobAttachment(other.office.id, saved.id), false);
  assert.equal(fs.existsSync(filePath!), true, "cross-office delete must be a no-op");

  // Correct office removes file + row.
  assert.equal(await storage.deleteJobAttachment(office.id, saved.id), true);
  assert.equal(fs.existsSync(filePath!), false);
  assert.equal((await storage.getJobAttachmentsByOrderId(office.id, job.orderId)).length, 0);
});

test("deleteJobAttachmentsByOrderId bulk-removes every upload for an order", async () => {
  const { office, user } = await seedOffice("Permanent Delete Optical");
  const job = await seedJob(office.id, user.id);

  const files: string[] = [];
  for (const name of ["a.pdf", "b.png", "c.txt"]) {
    const ext = name.split(".").pop()!;
    const saved = await storage.saveJobAttachment({
      officeId: office.id,
      jobOrderId: job.orderId,
      fileBuffer: Buffer.from(`bytes-${name}`),
      fileName: name,
      ext,
      mimeType: null,
      createdBy: user.id,
    });
    files.push(storage.resolveJobAttachmentPath(saved)!);
  }
  assert.equal((await storage.getJobAttachmentsByOrderId(office.id, job.orderId)).length, 3);

  await storage.deleteJobAttachmentsByOrderId(office.id, job.orderId);

  assert.equal((await storage.getJobAttachmentsByOrderId(office.id, job.orderId)).length, 0);
  for (const f of files) assert.equal(fs.existsSync(f), false, `${f} should be unlinked`);
});

test("orderIdExistsInOffice gates to a real order, active or archived, same office", async () => {
  const { office, user } = await seedOffice("Gate Optical");
  const other = await seedOffice("Gate Bystander Optical");

  const activeJob = await seedJob(office.id, user.id);
  assert.equal(await storage.orderIdExistsInOffice(office.id, activeJob.orderId), true);

  // Unknown id → false.
  assert.equal(await storage.orderIdExistsInOffice(office.id, "ORD-9999-9999"), false);

  // Cross-office → false even though the order exists somewhere.
  assert.equal(await storage.orderIdExistsInOffice(other.office.id, activeJob.orderId), false);

  // Archived order is still "real" — uploads can land on archived jobs.
  const toArchive = await seedJob(office.id, user.id, "completed");
  await storage.archiveJob(toArchive);
  await storage.deleteJob(toArchive.id);
  assert.equal(await storage.orderIdExistsInOffice(office.id, toArchive.orderId), true);
});
