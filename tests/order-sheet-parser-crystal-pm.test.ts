/**
 * Real-world parser fixtures from Crystal PM.
 *
 * The fixtures below are the EXACT extracted-text output the desktop
 * watcher produces from the two sample Crystal PM PDFs the user
 * provided during testing. Captured via the watcher's
 * linesFromTextContent() pass so the fixtures stay representative of
 * what the parser actually receives in production.
 *
 * Each test pins the bug it was added for, so a regression in the
 * fixtures is loud and obvious:
 *
 *  - Glasses order: was misclassified as "contacts" (false positive on
 *    "Lab Contact #" header), and its Order Date lost to Dispense Date.
 *  - Contact Lens order: had its patient name overwritten by the
 *    "Contact Lens Order" document title due to column drift, and lab
 *    "Bausch & Lomb" didn't match the office's "B+L" option.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseOrderSheet } from "../shared/order-sheet-parser";

const DEFAULT_JOB_TYPES = [
  { id: "contacts", label: "Contacts" },
  { id: "glasses", label: "Glasses" },
  { id: "sunglasses", label: "Sunglasses" },
  { id: "prescription", label: "Prescription" },
];

const DEFAULT_DESTINATIONS = [
  { id: "hoya", label: "Hoya" },
  { id: "essilor", label: "Essilor" },
  { id: "zeiss", label: "Zeiss" },
  { id: "abb", label: "ABB" },
  { id: "alcon", label: "Alcon" },
  { id: "coopervision", label: "CooperVision" },
  { id: "jj_vision", label: "J&J Vision" },
  { id: "bausch_lomb", label: "B+L" },
];

const OFFICE = {
  jobTypes: DEFAULT_JOB_TYPES,
  destinations: DEFAULT_DESTINATIONS,
  identifierMode: "patientName" as const,
  now: new Date("2026-06-11T12:00:00"),
};

// Extracted text from Crystal PM "Glasses Order Test.pdf" via the
// watcher's column-aware line reconstruction. Tabs are real \t chars.
const GLASSES_ORDER_TEXT = [
  "Patient:\ttest, test\tOrder Date:\t04/28/2025",
  "Authorization #:\t____________________________",
  "DOB:\t01/01/1900\tGender:\tF",
  "Optician/Staff:\t____________________________",
  "Contact #\t(657) 650-2020",
  "Ordered/Ref.#/Date: ____________________________",
  "Lab/Vendor:",
  "Expected Date:\t5/12/2025",
  "Lab Contact #\tLab Order #",
  "Dispensed",
  "Dispense Date: 06/30/2025\tAcct ID: 10000\tStatus:",
  "Provider:",
  "Sphere\tCylinder\tAxis\tVert Prism Hori Prism\tAdd\tSeg Ht\tDPD:\tMono PD",
  "OD -1.00\t-0.50\t180\t1.50\tR: 32.5",
  "NPD:",
  "OS -2.00\t-1.00\t170\t1.50\tL: 32",
  "Frame Sale\tLens Type:\tProgressive",
  "Frame Order:",
  "803926512509\tDescription:\tPAL - Zeiss Light 2 3D M 16mm",
  "Frame UPC:",
  "MODO\tMaterial:\tPolycarbonate 1.59",
  "Manufacturer:",
  "Collection:\tECO\tTint:",
  "Name:\tArakawa + Clip\tEdge:",
  "Color:\tBLKG Black Tort Gradient\tCoating:\tZeiss Set AR",
  "Material:\tZyl\tCoating:\tZeiss PhotoFusion X Extra Grey",
  "Style:\tCoating:",
  "Eye\tDbl\tTmpls\tA\tB\tED\tOther:",
  "54\t18\t140\t54\t36\t54",
  "Frm Wrap PantoTilt\tVertex OD Vertex OS OC OD\tOC OS",
  "___ Special Order\t25\t25",
  "Notes To Lab\tPat Bal $530.00\tIns Bal $0.00",
  "Dr. Test, EXP 05/26/2023Distance only",
].join("\n");

test("Crystal PM frame order parses confidently (real PDF extract)", () => {
  const result = parseOrderSheet(GLASSES_ORDER_TEXT, OFFICE);
  assert.equal(result.confident, true, `expected confident; missing: ${result.missing.join(", ")}`);
  assert.equal(result.fields.patientFirstName, "test");
  assert.equal(result.fields.patientLastName, "test");
  // Phone is "Contact # (657) 650-2020" — no colon, but the no-colon
  // path catches it.
  assert.equal(result.fields.phone, "6576502020");
  // Frame Order → Glasses via the EHR alias (would otherwise have been
  // misclassified as Contacts on "Lab Contact #").
  assert.equal(result.fields.jobTypeId, "glasses");
  // 04/28 is the actual Order Date; 06/30 is the Dispense Date that
  // used to win the race linearly.
  assert.equal(result.fields.orderDate, "2025-04-28");
  // Zeiss appears repeatedly in the lens coating list, picked up by
  // the destination scan against the office's "Zeiss" option.
  assert.equal(result.fields.destinationId, "zeiss");
});

// Extracted text from Crystal PM "Contact Lens Order Test.pdf".
const CONTACT_LENS_ORDER_TEXT = [
  "141 N Glassell St",
  "Orange, CA 92866",
  "P. 657-650-2020",
  "F. 657-650-2021",
  "E. contact@hello-optometry.com",
  "test, test\tTo:",
  "Patient:\tContact Lens Order",
  "test",
  "test, CA 92866-1406",
  "(657) 650-2020",
  "Phone:\tFax:",
  "X Ship to Patient Address",
  "Order Date: 5/03/2025\t___ Re-Order Date:",
  "Due Date: 5/10/2025",
  "Quantity: OD: 4\tOD Product: Boxes\tDispense Date:\tAcct ID: 10000",
  "OS: 4\tOS Product: Boxes\tProvider: Dr. Cho, Michelle",
  "Patient Balance\t$530.00\tInsurance Balance $0.00\tTechnician:",
  "Manufacturer\tSeries\tDescription",
  "OD Bausch & Lomb\tBiotrue ONEday 90pk-Sphere\t-05.00 8.6 14.20 [Daily] 90pk",
  "OS Bausch & Lomb\tBiotrue ONEday 90pk-Sphere\t-08.00 8.6 14.20 [Daily] 90pk",
  "Notes:",
  "Vendor Notes:",
  "Dr. Cho, Michelle\t___ Requires A Dispensing Appointment",
  "___ Requires A Progress Appointment",
  "___ Does Not Require An Additional Appointment",
].join("\n");

test("Crystal PM contact lens order parses confidently (real PDF extract)", () => {
  const result = parseOrderSheet(CONTACT_LENS_ORDER_TEXT, OFFICE);
  assert.equal(result.confident, true, `expected confident; missing: ${result.missing.join(", ")}`);
  // Patient name comes from the standalone "test, test\tTo:" segment
  // fallback — the "Patient: Contact Lens Order" pair gets rejected by
  // the title blocklist (the value contains "lens" / "order").
  assert.equal(result.fields.patientFirstName, "test");
  assert.equal(result.fields.patientLastName, "test");
  // "Contact Lens" → office's Contacts via the EHR alias.
  assert.equal(result.fields.jobTypeId, "contacts");
  // "Bausch & Lomb" → office's "B+L" via the lab alias.
  assert.equal(result.fields.destinationId, "bausch_lomb");
  assert.equal(result.fields.orderDate, "2025-05-03");
  assert.equal(result.fields.phone, "6576502020");
});

test("title-shaped values never overwrite a real patient name", () => {
  // Synthetic: the line collision happened in real Crystal output. Pin
  // the title rejection so a future change to extractPairs that lets a
  // "Patient: Frame Order" pair through still gets caught.
  const text = ["Patient:\tFrame Order Sheet", "test, doe", "Type: Glasses", "Lab: Zeiss"].join("\n");
  const result = parseOrderSheet(text, OFFICE);
  assert.equal(result.fields.patientFirstName, "doe");
  assert.equal(result.fields.patientLastName, "test");
});

test('"Contact #" phone label does not false-match the Contacts job type', () => {
  // No explicit job type, just a phone label that contains the word
  // "Contact". The pre-fix behavior was: scanLinesForOption tokenized
  // "Lab Contact #" and matched "contacts" via plural tolerance, then
  // locked jobTypeId before the (correct) alias scan could see "Frame".
  const text = [
    "Patient:\tJane Doe",
    "Order Date:\t04/28/2025",
    "Contact #\t(555) 123-4567",
    "Lab Contact #\tLab Order #",
    "Frame Order:\tFrame Sale",
    "Lab:\tZeiss",
  ].join("\n");
  const result = parseOrderSheet(text, OFFICE);
  assert.equal(result.fields.jobTypeId, "glasses", "Frame Order alias should win over Contact # noise");
  assert.equal(result.fields.phone, "5551234567");
});

test("Order Date wins over Dispense Date regardless of text order", () => {
  // Dispense first, Order Date later — pre-fix behavior took the first
  // dispense-or-order-date match wins.
  const text = [
    "Patient:\tJane Doe",
    "Dispense Date:\t06/30/2025",
    "Type:\tGlasses",
    "Lab:\tZeiss",
    "Order Date:\t04/28/2025",
  ].join("\n");
  const result = parseOrderSheet(text, OFFICE);
  assert.equal(result.fields.orderDate, "2025-04-28");
});

test('"Bausch & Lomb" matches an office that calls the lab "B+L"', () => {
  const text = [
    "Patient:\tJane Doe",
    "Order Date:\t04/28/2025",
    "Type:\tContacts",
    "OD Bausch & Lomb\tBiotrue ONEday 90pk",
  ].join("\n");
  const result = parseOrderSheet(text, OFFICE);
  assert.equal(result.fields.destinationId, "bausch_lomb");
});
