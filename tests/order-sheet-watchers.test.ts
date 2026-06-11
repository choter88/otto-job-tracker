/**
 * Order-sheet watcher presence (the "Watching from" panel's data layer).
 *
 * Pins the storage contract the heartbeat endpoints rely on:
 *  - upsert is idempotent per device (one row per machine, refreshed
 *    heartbeat timestamp, office/folder/state updates apply in place)
 *  - the office list joins user-set device names from client_devices
 *  - disabled watchers silently age out of the list after a week, while
 *    ENABLED-but-silent watchers stay visible forever (that's the alarm
 *    the panel exists to raise)
 *  - delete is office-scoped
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-watchers-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "watchers.sqlite");

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

test("heartbeat upsert, custom-name join, stale filtering, and delete", async () => {
  const office = await storage.createOffice({ name: "Presence Optical" } as any);

  // First heartbeat creates the row.
  const first = await storage.upsertOrderSheetWatcher({
    deviceId: "device-front-desk",
    officeId: office.id,
    deviceLabel: "Mac · Chrome",
    folderPath: "/Users/frontdesk/Order Sheets",
    enabled: true,
    state: "watching",
  });
  assert.equal(first.state, "watching");

  // Second heartbeat updates in place — still exactly one row.
  await storage.upsertOrderSheetWatcher({
    deviceId: "device-front-desk",
    officeId: office.id,
    deviceLabel: "Mac · Chrome",
    folderPath: "/Users/frontdesk/Order Sheets",
    enabled: true,
    state: "error",
    error: "Folder missing",
  });

  // A user-renamed device (Computers tab) surfaces its custom name.
  sqlite
    .prepare(`INSERT INTO client_devices (id, office_id, name) VALUES (?, ?, ?)`)
    .run("device-front-desk", office.id, "Front Desk");

  let watchers = await storage.getOrderSheetWatchersByOffice(office.id);
  assert.equal(watchers.length, 1);
  assert.equal(watchers[0].state, "error");
  assert.equal(watchers[0].error, "Folder missing");
  assert.equal(watchers[0].customName, "Front Desk");

  // A DISABLED watcher that went quiet over a week ago ages out of the
  // list; an ENABLED one that went quiet must stay visible (that's the
  // "your front desk stopped reporting" alarm).
  const staleMs = Date.now() - 8 * 24 * 60 * 60 * 1000;
  await storage.upsertOrderSheetWatcher({
    deviceId: "device-retired",
    officeId: office.id,
    enabled: false,
    state: "stopped",
  });
  await storage.upsertOrderSheetWatcher({
    deviceId: "device-silent-but-on",
    officeId: office.id,
    enabled: true,
    state: "watching",
  });
  sqlite
    .prepare(`UPDATE order_sheet_watchers SET last_heartbeat_at = ? WHERE device_id IN (?, ?)`)
    .run(staleMs, "device-retired", "device-silent-but-on");

  watchers = await storage.getOrderSheetWatchersByOffice(office.id);
  const ids = watchers.map((w) => w.deviceId).sort();
  assert.deepEqual(ids, ["device-front-desk", "device-silent-but-on"]);

  // Delete is office-scoped: a different office can't remove the row.
  const otherOffice = await storage.createOffice({ name: "Other Optical" } as any);
  await storage.deleteOrderSheetWatcher(otherOffice.id, "device-front-desk");
  watchers = await storage.getOrderSheetWatchersByOffice(office.id);
  assert.equal(watchers.some((w) => w.deviceId === "device-front-desk"), true);

  await storage.deleteOrderSheetWatcher(office.id, "device-front-desk");
  watchers = await storage.getOrderSheetWatchersByOffice(office.id);
  assert.equal(watchers.some((w) => w.deviceId === "device-front-desk"), false);
});
