/**
 * D14.1 minimum-necessary (164.502(b)): desktop notification TITLES are
 * stored in the notifications table (cloud-resident under the GCP pivot)
 * and surfaced as OS-level desktop notifications, which can be glanced at
 * by anyone near the screen. Titles must reference the order id only —
 * never the patient's name. The client bell already has jobId /
 * metadata.orderId and resolves the display name locally from the job it
 * already shows.
 *
 * notification-service.ts pulls in sync-websocket -> db at import time, so
 * point it at a throwaway sqlite file rather than the user's real
 * ~/.otto-job-tracker/otto.sqlite before importing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-notif-no-names-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "no-names.sqlite");

const { notificationTitle } = await import("../server/notification-service");

test("status_change title contains the order id, not the patient name", () => {
  const title = notificationTitle("status_change", {
    orderId: "A1",
    patientFirstName: "Jane",
    patientLastName: "Doe",
  } as any);
  assert.ok(title.includes("A1"), `expected title to include "A1", got: ${title}`);
  assert.ok(!title.includes("Jane"), `title must not include "Jane", got: ${title}`);
  assert.ok(!title.includes("Doe"), `title must not include "Doe", got: ${title}`);
});

test("comment title contains the order id, not the patient name", () => {
  const title = notificationTitle("comment", {
    orderId: "A2",
    patientFirstName: "Jane",
    patientLastName: "Doe",
  } as any);
  assert.ok(title.includes("A2"), `expected title to include "A2", got: ${title}`);
  assert.ok(!title.includes("Jane"), `title must not include "Jane", got: ${title}`);
  assert.ok(!title.includes("Doe"), `title must not include "Doe", got: ${title}`);
});

test("starred title contains the order id, not the patient name", () => {
  const title = notificationTitle("starred", {
    orderId: "A3",
    patientFirstName: "Jane",
    patientLastName: "Doe",
  } as any);
  assert.ok(title.includes("A3"), `expected title to include "A3", got: ${title}`);
  assert.ok(!title.includes("Jane"), `title must not include "Jane", got: ${title}`);
  assert.ok(!title.includes("Doe"), `title must not include "Doe", got: ${title}`);
});

test("job_created title contains the order id, not the patient name", () => {
  const title = notificationTitle("job_created", {
    orderId: "A4",
    patientFirstName: "Jane",
    patientLastName: "Doe",
  } as any);
  assert.ok(title.includes("A4"), `expected title to include "A4", got: ${title}`);
  assert.ok(!title.includes("Jane"), `title must not include "Jane", got: ${title}`);
  assert.ok(!title.includes("Doe"), `title must not include "Doe", got: ${title}`);
});

test("overdue title contains the order id, not the patient name", () => {
  const title = notificationTitle("overdue", {
    orderId: "A5",
    patientFirstName: "Jane",
    patientLastName: "Doe",
  } as any);
  assert.ok(title.includes("A5"), `expected title to include "A5", got: ${title}`);
  assert.ok(!title.includes("Jane"), `title must not include "Jane", got: ${title}`);
  assert.ok(!title.includes("Doe"), `title must not include "Doe", got: ${title}`);
});

test("missing orderId falls back to trayNumber", () => {
  const title = notificationTitle("job_created", {
    trayNumber: "T-77",
    patientFirstName: "Jane",
    patientLastName: "Doe",
  } as any);
  assert.ok(title.includes("T-77"), `expected fallback to trayNumber, got: ${title}`);
  assert.ok(!title.includes("Jane"), `title must not include "Jane", got: ${title}`);
});

test("missing orderId and trayNumber falls back to a placeholder, never throws", () => {
  const title = notificationTitle("overdue", {
    patientFirstName: "Jane",
    patientLastName: "Doe",
  } as any);
  assert.ok(title.includes("(no order id)"), `expected placeholder fallback, got: ${title}`);
  assert.ok(!title.includes("Jane"), `title must not include "Jane", got: ${title}`);
});
