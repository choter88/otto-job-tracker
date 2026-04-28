/**
 * After SMS removal: notification rules should still create successfully even
 * when callers don't pass smsEnabled/smsTemplate. Schema has columns with
 * defaults (sms_enabled defaults false, sms_template nullable), so this is
 * a regression check that the column defaults still kick in.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-notif-no-sms-"));
const TEST_DB_PATH = path.join(TEST_DIR, "no-sms.sqlite");

process.env.OTTO_SQLITE_PATH = TEST_DB_PATH;

const { storage } = await import("../server/storage");
const { sqlite } = await import("../server/db");

function resetDb() {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    DELETE FROM notification_rules;
    DELETE FROM offices;
  `);
  sqlite.pragma("foreign_keys = ON");
}

test.beforeEach(() => {
  resetDb();
});

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // ignore
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test("createNotificationRule without SMS fields succeeds and defaults sms_enabled=false", async () => {
  const office = await storage.createOffice({ name: "Notif Office" });
  const rule = await storage.createNotificationRule({
    officeId: office.id,
    status: "ordered",
    maxDays: 5,
    enabled: true,
    notifyRoles: ["owner"],
    notifyUsers: [],
  } as any);

  assert.equal(rule.smsEnabled, false);
  assert.equal(rule.smsTemplate, null);
  assert.equal(rule.status, "ordered");
  assert.equal(rule.maxDays, 5);
});

test("updateNotificationRule with no SMS fields preserves defaults", async () => {
  const office = await storage.createOffice({ name: "Update Office" });
  const created = await storage.createNotificationRule({
    officeId: office.id,
    status: "ordered",
    maxDays: 3,
    enabled: true,
    notifyRoles: ["manager"],
    notifyUsers: [],
  } as any);
  const updated = await storage.updateNotificationRule(created.id, { maxDays: 10 });
  assert.equal(updated.maxDays, 10);
  assert.equal(updated.smsEnabled, false);
});
