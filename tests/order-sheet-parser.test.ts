/**
 * Tests for the order-sheet field parser (shared/order-sheet-parser.ts).
 *
 * The parser is the trust boundary of the folder automation: anything it
 * gets wrong either creates a bad job silently (worst case) or dumps
 * sheets into the review queue (annoying). These tests pin down:
 *  - labeled-field extraction across EHR formatting styles,
 *  - the DOB / order-date disambiguation (a DOB must never become the
 *    job's creation date),
 *  - office-list matching incl. plural tolerance ("FRAME ORDER" → "Frames"),
 *  - the confidence rules that decide auto-create vs needs-review.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  matchOption,
  parseOrderSheet,
  parseSheetDate,
  splitPatientName,
} from "../shared/order-sheet-parser";

const OFFICE = {
  jobTypes: [
    { id: "frames", label: "Frames" },
    { id: "lenses_only", label: "Lenses Only" },
    { id: "sunglasses", label: "Sunglasses" },
  ],
  destinations: [
    { id: "vision_lab", label: "Vision Lab" },
    { id: "eyetech", label: "EyeTech Labs" },
  ],
  identifierMode: "patientName" as const,
  now: new Date("2026-06-10T12:00:00"),
};

test("typical labeled sheet parses confidently", () => {
  const text = [
    "ACME OPTICAL — FRAME ORDER",
    "Order Date: 06/09/2026",
    "Patient: Jane Doe",
    "DOB: 01/02/1980",
    "Phone: (555) 123-4567",
    "Tray #: 142",
    "Order Type: Frames",
    "Lab: Vision Lab",
    "Notes: Patient prefers titanium",
  ].join("\n");

  const result = parseOrderSheet(text, OFFICE);
  assert.equal(result.confident, true, `missing: ${result.missing.join(", ")}`);
  assert.equal(result.fields.patientFirstName, "Jane");
  assert.equal(result.fields.patientLastName, "Doe");
  assert.equal(result.fields.phone, "5551234567");
  assert.equal(result.fields.trayNumber, "142");
  assert.equal(result.fields.jobTypeId, "frames");
  assert.equal(result.fields.destinationId, "vision_lab");
  assert.equal(result.fields.orderDate, "2026-06-09");
  assert.equal(result.fields.notes, "Patient prefers titanium");
});

test("DOB never leaks into the order date", () => {
  const result = parseOrderSheet(
    ["Patient Name: John Smith", "Date of Birth: 03/15/1962", "Type: Sunglasses", "Lab: EyeTech Labs"].join("\n"),
    OFFICE,
  );
  assert.equal(result.fields.orderDate, "", "DOB must not be read as the order date");
  assert.equal(result.fields.jobTypeId, "sunglasses");
  assert.equal(result.fields.destinationId, "eyetech");
});

test("several fields on one printed row (wide-gap separated)", () => {
  const result = parseOrderSheet(
    ["Patient: Doe, Jane M.    DOB: 01/02/1980    Phone: 555.123.4567", "Order: Lenses Only    Send to: Vision Lab"].join("\n"),
    OFFICE,
  );
  assert.equal(result.fields.patientFirstName, "Jane");
  assert.equal(result.fields.patientLastName, "Doe");
  assert.equal(result.fields.phone, "5551234567");
  assert.equal(result.fields.jobTypeId, "lenses_only");
  assert.equal(result.fields.destinationId, "vision_lab");
  assert.equal(result.confident, true);
});

test("a big FRAME ORDER title resolves to the office's Frames type", () => {
  const result = parseOrderSheet(
    ["FRAME ORDER", "Patient: Amy Pond", "Lab: Vision Lab"].join("\n"),
    OFFICE,
  );
  assert.equal(result.fields.jobTypeId, "frames");
  assert.equal(result.confident, true);
});

test("unmatched order type goes to review but keeps the sheet's raw text", () => {
  const result = parseOrderSheet(
    ["Patient: Amy Pond", "Order Type: Contact Lens Fitting", "Lab: Vision Lab"].join("\n"),
    OFFICE,
  );
  assert.equal(result.confident, false);
  assert.ok(result.missing.includes("order type"));
  assert.equal(result.fields.jobTypeText, "Contact Lens Fitting");
});

test("single configured lab is auto-filled instead of forcing review", () => {
  const result = parseOrderSheet(
    ["Patient: Amy Pond", "Type: Frames"].join("\n"),
    { ...OFFICE, destinations: [{ id: "only_lab", label: "Main Lab" }] },
  );
  assert.equal(result.fields.destinationId, "only_lab");
  assert.equal(result.confident, true);
});

test("tray-number mode: tray alone is enough identity", () => {
  const result = parseOrderSheet(
    ["Tray No. A-17", "Type: Frames", "Lab: Vision Lab"].join("\n"),
    { ...OFFICE, identifierMode: "trayNumber" },
  );
  assert.equal(result.fields.trayNumber, "A-17");
  assert.equal(result.confident, true);
});

test("missing patient name blocks auto-create in patient-name mode", () => {
  const result = parseOrderSheet(["Type: Frames", "Lab: Vision Lab"].join("\n"), OFFICE);
  assert.equal(result.confident, false);
  assert.ok(result.missing.includes("patient name"));
});

test("doctor/provider name lines never feed the patient field", () => {
  const result = parseOrderSheet(
    ["Doctor Name: Dr. Strange", "Provider: B. Banner OD", "Type: Frames", "Lab: Vision Lab"].join("\n"),
    OFFICE,
  );
  assert.equal(result.fields.patientFirstName, "");
  assert.equal(result.fields.patientLastName, "");
  assert.equal(result.confident, false);
});

test("future order dates are dropped (misparse protection)", () => {
  const result = parseOrderSheet(
    ["Patient: Amy Pond", "Order Date: 12/31/2026", "Type: Frames", "Lab: Vision Lab"].join("\n"),
    OFFICE,
  );
  assert.equal(result.fields.orderDate, "");
  assert.equal(result.confident, true, "a dropped date should not block auto-create");
});

test("empty text yields a non-confident result with everything missing", () => {
  const result = parseOrderSheet("", OFFICE);
  assert.equal(result.confident, false);
  assert.deepEqual(result.missing, ["patient name", "order type", "lab"]);
});

// ── parseSheetDate ──────────────────────────────────────────────────────

test("parseSheetDate handles common US formats", () => {
  assert.equal(parseSheetDate("06/09/2026"), "2026-06-09");
  assert.equal(parseSheetDate("6/9/26"), "2026-06-09");
  assert.equal(parseSheetDate("2026-06-09"), "2026-06-09");
  assert.equal(parseSheetDate("June 9, 2026"), "2026-06-09");
  assert.equal(parseSheetDate("Jun 9 2026"), "2026-06-09");
  assert.equal(parseSheetDate("06/09/2026 3:14 PM"), "2026-06-09");
});

test("parseSheetDate rejects garbage", () => {
  assert.equal(parseSheetDate("13/45/2026"), "");
  assert.equal(parseSheetDate("02/30/2026"), "");
  assert.equal(parseSheetDate("not a date"), "");
  assert.equal(parseSheetDate(""), "");
});

// ── splitPatientName ────────────────────────────────────────────────────

test("splitPatientName handles the formats EHRs print", () => {
  assert.deepEqual(splitPatientName("Jane Doe"), { first: "Jane", last: "Doe" });
  assert.deepEqual(splitPatientName("Doe, Jane"), { first: "Jane", last: "Doe" });
  assert.deepEqual(splitPatientName("Jane M. Doe"), { first: "Jane", last: "Doe" });
  assert.deepEqual(splitPatientName("Mary Anne Van Der Berg"), { first: "Mary", last: "Anne Van Der Berg" });
  assert.deepEqual(splitPatientName("Jane Doe (DOB 01/02/1980)"), { first: "Jane", last: "Doe" });
});

// ── matchOption ─────────────────────────────────────────────────────────

test("matchOption tiers: exact, containment, plural-tolerant tokens", () => {
  const options = OFFICE.jobTypes;
  assert.equal(matchOption("frames", options), "frames");
  assert.equal(matchOption("Lenses", options), "lenses_only");
  assert.equal(matchOption("frame", options), "frames");
  assert.equal(matchOption("completely unrelated", options), "");
  assert.equal(matchOption("", options), "");
});

test("'Job Kind' and 'Send Via' label variants are recognized", () => {
  const text = [
    "ABC Optical Lab Slip",
    "Account Holder:\tDoe, Jane",
    "Job Kind:\tFrame Order",
    "Send Via:\tVision Lab",
  ].join("\n");
  const result = parseOrderSheet(text, OFFICE);
  // "Frame Order" maps through the office's "Frames" option; the raw
  // text must be kept either way so the review UI (and the correction
  // learner) can see what the sheet said under those labels.
  assert.equal(result.fields.jobTypeText, "Frame Order");
  assert.equal(result.fields.jobTypeId, "frames");
  assert.equal(result.fields.destinationText, "Vision Lab");
  assert.equal(result.fields.destinationId, "vision_lab");
});
