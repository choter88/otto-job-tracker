/**
 * Archive/restore round-trip for the tray-number identifier.
 *
 * Offices in `jobIdentifierMode: "trayNumber"` keep patient name fields
 * blank by design — the tray number is a job's ONLY identifier. archiveJob
 * historically didn't copy trayNumber into archived_jobs (and restore
 * didn't copy it back), so completing a job erased its identity from
 * Past Jobs and broke the Redo flow. These tests pin the fix:
 *
 *   create (tray T-142) → archive → search archive by tray → restore
 *
 * with the tray number — and the `source` provenance marker — surviving
 * every hop.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-archive-tray-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "archive-tray.sqlite");

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

test("tray number and source survive archive, search, and restore", async () => {
  const office = await storage.createOffice({ name: "Tray Mode Optical" } as any);
  const user = await storage.createUser({
    email: "owner@traymode.local",
    loginId: "tray-owner",
    password: "hash.hash",
    firstName: "Tray",
    lastName: "Owner",
    role: "owner",
    officeId: office.id,
  } as any);

  // Tray-mode job: names intentionally blank, tray is the identifier.
  const job = await storage.createJob({
    patientFirstName: "",
    patientLastName: "",
    trayNumber: "T-142",
    jobType: "glasses",
    status: "completed",
    orderDestination: "hoya",
    officeId: office.id,
    createdBy: user.id,
    source: "order_sheet",
  } as any);
  assert.equal(job.trayNumber, "T-142");

  // Archive — the tray and provenance must come along.
  const archived = await storage.archiveJob(job);
  assert.equal(archived.trayNumber, "T-142", "archiveJob dropped the tray number");
  assert.equal(archived.source, "order_sheet", "archiveJob dropped the source marker");
  assert.equal(archived.finalStatus, "completed");
  await storage.deleteJob(job.id);

  // The Past Jobs search box must match tray numbers (tray-mode offices
  // have nothing else to search by).
  const byTray = await storage.getArchivedJobsByOffice(office.id, undefined, undefined, "t-14");
  assert.equal(byTray.length, 1, "archive search did not match the tray number");
  assert.equal(byTray[0].id, archived.id);

  const noMatch = await storage.getArchivedJobsByOffice(office.id, undefined, undefined, "zzz");
  assert.equal(noMatch.length, 0);

  // Restore — identifier and provenance round-trip back to the worklist.
  const restored = await storage.restoreArchivedJob(archived.id);
  assert.equal(restored.trayNumber, "T-142", "restoreArchivedJob dropped the tray number");
  assert.equal(restored.source, "order_sheet", "restoreArchivedJob dropped the source marker");
  assert.equal(restored.status, "job_created");

  const remaining = await storage.getArchivedJobsByOffice(office.id);
  assert.equal(remaining.length, 0, "restored job should leave the archive");
});
