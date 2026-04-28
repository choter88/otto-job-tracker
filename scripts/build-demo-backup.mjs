#!/usr/bin/env node
/**
 * Build a demo SQLite backup file for testing the desktop app's
 * "File → Restore Data…" feature.
 *
 * The Restore feature does a direct file copy (desktop/main.js:852), so the
 * file just needs to be a complete Otto SQLite database with the current
 * schema. We use the existing 2026-04-26-000428.sqlite as the schema template
 * and populate it with realistic test data via the `sqlite3` CLI (no
 * native-module rebuild required).
 *
 * Run with: node scripts/build-demo-backup.mjs
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { promisify } from "util";

// Same scrypt params the server uses (server/secret-hash.ts).
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 2, maxmem: 67_108_864 };
const HASH_V2_PREFIX = "v2:";

const scryptAsync = promisify(crypto.scrypt);

async function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  const buf = await scryptAsync(secret, salt, 64, SCRYPT_PARAMS);
  return `${HASH_V2_PREFIX}${buf.toString("hex")}.${salt}`;
}

const TEMPLATE_PATH = "/Users/petercho/Documents/otto tracker backups/otto-backup-2026-04-26-000428.sqlite";
const OUTPUT_PATH = "/Users/petercho/Documents/otto tracker backups/otto-backup-DEMO.sqlite";

if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error(`Template not found: ${TEMPLATE_PATH}`);
  process.exit(1);
}

// Start fresh from the template (it has the schema we need).
fs.copyFileSync(TEMPLATE_PATH, OUTPUT_PATH);

const NOW = Date.parse("2026-04-26T16:00:00Z");
const DAY = 86400 * 1000;

function uuid() {
  return crypto.randomUUID();
}

function escape(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function row(values) {
  return "(" + values.map(escape).join(", ") + ")";
}

const sqlChunks = [];
sqlChunks.push("PRAGMA foreign_keys = OFF;");
sqlChunks.push("BEGIN TRANSACTION;");

// Wipe data, keep schema.
const WIPE_TABLES = [
  "comment_reads", "job_comments", "job_flags", "job_status_history",
  "job_link_groups", "link_group_notes", "notification_rules", "notifications",
  "archived_jobs", "jobs", "account_signup_requests", "join_requests",
  "invitations", "pin_reset_requests", "tablet_sessions", "client_devices",
  "phi_access_logs", "admin_audit_logs", "usage_events", "platform_analytics",
  "job_analytics", "sms_logs", "sms_opt_ins", "users", "offices",
];
for (const t of WIPE_TABLES) {
  sqlChunks.push(`DELETE FROM ${t};`);
}

// ─── Hash credentials for the Owner account ──────────────────────────────
// All other users get placeholders (only the owner is sign-in-able).
const ownerPassword = "1337p373";
const ownerPin = "111111";
const ownerPasswordHash = await hashSecret(ownerPassword);
const ownerPinHash = await hashSecret(ownerPin);

// ─── Office ──────────────────────────────────────────────────────────────
const officeId = uuid();
const officeSettings = {
  customStatuses: [
    { id: "job_created",      label: "Job Created",      color: "#2563EB", order: 1 },
    { id: "ordered",          label: "Ordered",          color: "#D97706", order: 2 },
    { id: "in_progress",      label: "In Progress",      color: "#0284C7", order: 3 },
    { id: "edge_grinding",    label: "Edge Grinding",    color: "#A855F7", order: 4 },
    { id: "quality_check",    label: "Quality Check",    color: "#7C3AED", order: 5 },
    { id: "ready_for_pickup", label: "Ready for Pickup", color: "#16A34A", order: 6 },
    { id: "completed",        label: "Completed",        color: "#059669", order: 7 },
    { id: "cancelled",        label: "Cancelled",        color: "#DC2626", order: 8 },
  ],
  customJobTypes: [
    { id: "glasses",      label: "Glasses",      color: "#2563EB", order: 1 },
    { id: "contacts",     label: "Contacts",     color: "#475569", order: 2 },
    { id: "sunglasses",   label: "Sunglasses",   color: "#D97706", order: 3 },
    { id: "prescription", label: "Prescription", color: "#7C3AED", order: 4 },
    { id: "exam_frames",  label: "Exam Frames",  color: "#16A34A", order: 5 },
  ],
  customOrderDestinations: [
    { id: "essilor_lab",     label: "Essilor Lab",     color: "#0284C7", order: 1 },
    { id: "luxottica",       label: "Luxottica",       color: "#16A34A", order: 2 },
    { id: "central_optical", label: "Central Optical", color: "#D97706", order: 3 },
    { id: "vsp_optics",      label: "VSP Optics",      color: "#7C3AED", order: 4 },
    { id: "in_house",        label: "In-house",        color: "#475569", order: 5 },
  ],
  customColumns: [
    { id: "col_lab_order", name: "Lab Order #", type: "text",   order: 1, active: true, editableInWorklist: true },
    { id: "col_frame",     name: "Frame Model", type: "text",   order: 2, active: true, editableInWorklist: true },
    { id: "col_coating",   name: "Coating",     type: "select", order: 3, active: true, editableInWorklist: true,
      options: ["None", "Anti-Glare", "Crizal Sapphire", "Blue Light", "Polarized"] },
  ],
  jobIdentifierMode: "patientName",
  smsEnabled: false,
  smsTemplates: {
    job_created:      "Hi {patient_first_name}, we received your {job_type} order #{order_id}.",
    ordered:          "Your {job_type} order #{order_id} has been placed and is being processed.",
    in_progress:      "Update: Your {job_type} order #{order_id} is now in progress.",
    quality_check:    "Update: Your {job_type} order #{order_id} is in quality check.",
    ready_for_pickup: "Great news! Your {job_type} order #{order_id} is ready for pickup at {office_name}.",
    completed:        "Your {job_type} order #{order_id} has been completed.",
    cancelled:        "Your {job_type} order #{order_id} was cancelled. Please contact {office_name} at {office_phone}.",
  },
  // After file-copy restore, desktop/main.js overwrites this to `source: 'backup'`
  // so the BackupRestoreBanner shows. We seed it as backup-state directly here
  // so the demo file is internally consistent even if read outside the
  // restore flow.
  onboarding: {
    state: "completed",
    source: "backup",
    completedSteps: [
      "welcome", "identifier_mode", "statuses", "job_types",
      "destinations", "custom_columns", "notification_rules", "ehr_import", "done",
    ],
    skippedAt: null,
    completedAt: new Date(NOW - 7 * DAY).toISOString(),
    startedAt: new Date(NOW - 8 * DAY).toISOString(),
    version: 1,
  },
};

sqlChunks.push(`INSERT INTO offices (id, name, address, phone, email, enabled, settings, created_at, updated_at) VALUES ${row([
  officeId, "Peter's Optometry", "123 Main St, Springfield, IL 62701", "(555) 123-4567",
  "chopeter67@gmail.com", 1, JSON.stringify(officeSettings), NOW - 30 * DAY, NOW - DAY,
])};`);

// ─── Users ───────────────────────────────────────────────────────────────
// The Owner is sign-in-able with the credentials above (loginId `a.a`,
// PIN 111111, password 1337p373). Other users get placeholder hashes so
// they exist in the data set but can't sign in.
const PLACEHOLDER_PW = "RESTORE_DEMO_PLACEHOLDER";
const PLACEHOLDER_PIN = "RESTORE_DEMO_PIN_PLACEHOLDER";

const users = [
  // Owner — real credentials.
  { id: uuid(), email: "chopeter67@gmail.com", loginId: "a.a", firstName: "Peter", lastName: "Cho", role: "owner",
    password: ownerPasswordHash, pinHash: ownerPinHash },
  // Other team — placeholder creds.
  { id: uuid(), email: "manager@demoptometry.example", loginId: "manager", firstName: "Mira",    lastName: "Klein",   role: "manager",
    password: PLACEHOLDER_PW, pinHash: PLACEHOLDER_PIN },
  { id: uuid(), email: "front1@demoptometry.example",  loginId: "jordan",  firstName: "Jordan",  lastName: "Brooks",  role: "staff",
    password: PLACEHOLDER_PW, pinHash: PLACEHOLDER_PIN },
  { id: uuid(), email: "front2@demoptometry.example",  loginId: "ana",     firstName: "Ana",     lastName: "Torres",  role: "staff",
    password: PLACEHOLDER_PW, pinHash: PLACEHOLDER_PIN },
  { id: uuid(), email: "lab@demoptometry.example",     loginId: "reza",    firstName: "Reza",    lastName: "Sharma",  role: "staff",
    password: PLACEHOLDER_PW, pinHash: PLACEHOLDER_PIN },
  { id: uuid(), email: "viewer@demoptometry.example",  loginId: "drlee",   firstName: "Dr. Lee", lastName: "Park",    role: "view_only",
    password: PLACEHOLDER_PW, pinHash: PLACEHOLDER_PIN },
];

for (const u of users) {
  sqlChunks.push(`INSERT INTO users (id, email, login_id, password, pin_hash, first_name, last_name, role, office_id, preferences, created_at, updated_at) VALUES ${row([
    u.id, u.email, u.loginId, u.password, u.pinHash,
    u.firstName, u.lastName, u.role, officeId, "{}",
    NOW - 30 * DAY, NOW - DAY,
  ])};`);
}

const ownerId   = users[0].id;
const managerId = users[1].id;
const jordanId  = users[2].id;
const anaId     = users[3].id;
const rezaId    = users[4].id;
const CREATORS = [jordanId, anaId, managerId];

// ─── Jobs ────────────────────────────────────────────────────────────────
const PATIENTS = [
  ["Maria", "Rodriguez", "+1 (555) 555-0142"],
  ["Sarah", "Chen", "+1 (555) 555-0188"],
  ["Aarav", "Kapoor", "+1 (555) 555-0207"],
  ["Tyrell", "Brooks", "+1 (555) 555-0119"],
  ["Linh", "Park", "+1 (555) 555-0166"],
  ["Jamal", "Okafor", "+1 (555) 555-0193"],
  ["Kelly", "Liu", "+1 (555) 555-0102"],
  ["Daniel", "Schwartz", "+1 (555) 555-0211"],
  ["Beatrice", "Nakamura", "+1 (555) 555-0145"],
  ["Femi", "Adelaja", "+1 (555) 555-0177"],
  ["Rohan", "Mehta", "+1 (555) 555-0151"],
  ["Hideo", "Yamamoto", "+1 (555) 555-0124"],
  ["Galina", "Petrov", "+1 (555) 555-0163"],
  ["Nadia", "Abara", "+1 (555) 555-0184"],
  ["Chloe", "Watanabe", "+1 (555) 555-0118"],
  ["Owen", "Patel", "+1 (555) 555-0173"],
  ["Stephanie", "Garcia", "+1 (555) 555-0140"],
  ["Brandon", "Cohen", "+1 (555) 555-0156"],
  ["Yui", "Tanaka", "+1 (555) 555-0167"],
  ["Marcus", "Johnson", "+1 (555) 555-0181"],
];

const STATUSES_BY_ORDER = ["job_created", "ordered", "in_progress", "edge_grinding", "quality_check", "ready_for_pickup"];
const TYPES = ["glasses", "contacts", "sunglasses", "prescription", "exam_frames"];
const DESTS = ["essilor_lab", "luxottica", "central_optical", "vsp_optics", "in_house"];

const jobIds = [];
let orderSeq = 2400;
for (let i = 0; i < 25; i++) {
  const [first, last, phone] = PATIENTS[i % PATIENTS.length];
  const status = STATUSES_BY_ORDER[i % STATUSES_BY_ORDER.length];
  const type = TYPES[i % TYPES.length];
  const dest = DESTS[i % DESTS.length];
  const isRedo = i % 11 === 0;
  const createdAt = NOW - (25 - i) * (DAY / 2) - (i % 4) * 60 * 60 * 1000;
  const statusChangedAt = createdAt + Math.floor(2 + (i % 6)) * 60 * 60 * 1000;

  const customColVals = {
    col_lab_order: `LO-${10000 + i}`,
    col_frame: ["Ray-Ban Aviator", "Oakley OX3217", "Warby Parker Chase", "Persol PO3199", ""][i % 5],
    col_coating: ["Crizal Sapphire", "Anti-Glare", "None", "Polarized", "Blue Light"][i % 5],
  };

  const id = uuid();
  const orderId = `OT-${++orderSeq}`;
  jobIds.push({ id, orderId, status, createdAt });

  sqlChunks.push(`INSERT INTO jobs (id, order_id, patient_first_name, patient_last_name, tray_number, phone, job_type, status, order_destination, office_id, created_by, status_changed_at, custom_column_values, is_redo_job, original_job_id, notes, created_at, updated_at) VALUES ${row([
    id, orderId, first, last, null, phone,
    type, status, dest, officeId, CREATORS[i % CREATORS.length],
    statusChangedAt, JSON.stringify(customColVals),
    isRedo ? 1 : 0, null,
    i % 7 === 0 ? "Patient is allergic to nickel — confirm titanium frames." : null,
    createdAt, statusChangedAt,
  ])};`);

  // Status history — show the path through earlier statuses.
  const targetStep = STATUSES_BY_ORDER.indexOf(status);
  for (let s = 0; s <= targetStep; s++) {
    const ts = createdAt + s * 6 * 60 * 60 * 1000;
    const oldS = s === 0 ? null : STATUSES_BY_ORDER[s - 1];
    sqlChunks.push(`INSERT INTO job_status_history (id, job_id, old_status, new_status, changed_by, changed_at) VALUES ${row([
      uuid(), id, oldS, STATUSES_BY_ORDER[s], CREATORS[i % CREATORS.length], ts,
    ])};`);
  }

  // A few jobs get demo comments so the column shows non-zero counts.
  if (i % 3 === 0) {
    const numComments = (i % 4) + 1;
    const authors = [jordanId, anaId, rezaId, managerId];
    const texts = [
      "Frame ordered from supplier — ETA Tuesday.",
      "Confirmed coating with patient. Crizal Sapphire.",
      "Edge grinding complete. Lenses look good.",
      "Patient called — will pick up Friday afternoon.",
      "Lab returned with measurement adjustment needed.",
    ];
    for (let c = 0; c < numComments; c++) {
      const ts = createdAt + (c + 1) * 30 * 60 * 1000;
      sqlChunks.push(`INSERT INTO job_comments (id, job_id, author_id, content, is_overdue_comment, created_at) VALUES ${row([
        uuid(), id, authors[c % authors.length], texts[c % texts.length], 0, ts,
      ])};`);
    }
  }
}

// ─── Archived jobs ───────────────────────────────────────────────────────
for (let i = 0; i < 10; i++) {
  const [first, last, phone] = PATIENTS[(i + 5) % PATIENTS.length];
  const finalStatus = i < 8 ? "completed" : "cancelled";
  const archivedAt = NOW - (10 - i) * 3 * DAY;
  const createdAt = archivedAt - 5 * DAY;
  sqlChunks.push(`INSERT INTO archived_jobs (id, order_id, patient_first_name, patient_last_name, tray_number, phone, job_type, final_status, previous_status, order_destination, office_id, created_by, original_created_at, archived_at, custom_column_values, is_redo_job, original_job_id, notes) VALUES ${row([
    uuid(), `OT-${2300 + i}`, first, last, null, phone,
    TYPES[i % TYPES.length], finalStatus,
    finalStatus === "completed" ? "ready_for_pickup" : "in_progress",
    DESTS[i % DESTS.length], officeId, CREATORS[i % CREATORS.length],
    createdAt, archivedAt, "{}", 0, null, null,
  ])};`);
}

// ─── Notification rules ──────────────────────────────────────────────────
const rules = [
  { status: "ordered",          maxDays: 5,  enabled: 1, roles: ["owner", "manager"] },
  { status: "in_progress",      maxDays: 7,  enabled: 1, roles: ["owner", "manager"] },
  { status: "quality_check",    maxDays: 3,  enabled: 1, roles: ["manager"] },
  { status: "ready_for_pickup", maxDays: 14, enabled: 1, roles: ["owner", "manager", "staff"] },
];
for (const r of rules) {
  sqlChunks.push(`INSERT INTO notification_rules (id, office_id, status, max_days, enabled, sms_enabled, sms_template, notify_roles, notify_users, created_at) VALUES ${row([
    uuid(), officeId, r.status, r.maxDays, r.enabled, 0, null,
    JSON.stringify(r.roles), "[]", NOW - 20 * DAY,
  ])};`);
}

// ─── Important flags ─────────────────────────────────────────────────────
const importantPicks = jobIds.filter((_, i) => i % 7 === 0).slice(0, 3);
for (const j of importantPicks) {
  sqlChunks.push(`INSERT INTO job_flags (id, user_id, job_id, summary, summary_generated_at, important_note, important_note_updated_at, created_at) VALUES ${row([
    uuid(), ownerId, j.id, null, null,
    "Patient asked for rush turnaround.", j.createdAt, j.createdAt,
  ])};`);
}

sqlChunks.push("COMMIT;");
sqlChunks.push("PRAGMA foreign_keys = ON;");

const sql = sqlChunks.join("\n");

const result = spawnSync("sqlite3", [OUTPUT_PATH], {
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
});

if (result.status !== 0) {
  console.error(`sqlite3 exited with status ${result.status}`);
  process.exit(1);
}

console.log(`Wrote demo backup: ${OUTPUT_PATH}`);
console.log(`  - Office: Peter's Optometry`);
console.log(`  - Users: ${users.length} (1 owner, 1 manager, 3 staff, 1 view-only)`);
console.log(`  - Jobs: 25 active, 10 archived`);
console.log(`  - Custom: 8 statuses, 5 types, 5 labs, 3 columns`);
console.log(`  - Notification rules: ${rules.length}`);
console.log(`  - Important flags: ${importantPicks.length}`);
console.log(``);
console.log(`Restore via: File → Restore Data… → ${path.basename(OUTPUT_PATH)}`);
console.log(``);
console.log(`Owner sign-in (after restore + host setup):`);
console.log(`  Email:    chopeter67@gmail.com`);
console.log(`  Login ID: a.a`);
console.log(`  Password: 1337p373`);
console.log(`  PIN:      111111`);
