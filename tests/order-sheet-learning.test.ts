/**
 * Order-sheet learning ("the parser remembers your fixes").
 *
 * Pins, bottom-up:
 *  - fingerprint: same form template → same fingerprint regardless of the
 *    values printed on it; different label sets → different fingerprints;
 *    label-poor documents → no fingerprint (nothing learned/applied)
 *  - derive: a review correction produces anchor rules tied to the printed
 *    label next to the corrected value (right-of-label, inline, and
 *    below-label forms); values NOT on the sheet teach nothing; option
 *    corrections become raw-text → option-id mappings
 *  - apply: rules extract from a NEW sheet of the same form, values are
 *    re-validated (dates → ISO, phones → digits), and option ids that no
 *    longer exist in office settings are dropped
 *  - storage: rules upsert per (office, fingerprint, field), valueMaps merge
 *  - end-to-end: a real generated PDF goes through the server extractor →
 *    fingerprint → derive → store → apply, and computeMissing flips the
 *    sheet from needs-review to confident
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-learning-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "learning.sqlite");

const { storage } = await import("../server/storage");
const { sqlite } = await import("../server/db");
const {
  computeOrderSheetFingerprint,
  deriveOrderSheetAnchorRules,
  applyOrderSheetAnchorRules,
  mergeLearnedFields,
  changedLearnableFields,
} = await import("../shared/order-sheet-layout");
const { computeMissingOrderSheetFields, parseOrderSheet } = await import("../shared/order-sheet-parser");
const { extractOrderSheetLayoutFromPdf, applyLearnedOrderSheetTemplates, learnFromOrderSheetCorrection } =
  await import("../server/order-sheet-learning");

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // ignore
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── Synthetic layout helpers ───────────────────────────────────────────

// Approximate Helvetica width at 11pt — close enough for the gap math
// (segments split when gap > fontSize * 1.2 ≈ 13px; our columns are 50+
// pixels apart).
function item(str: string, x: number, y: number) {
  return { str, x, y, w: str.length * 5.5, fs: 11 };
}

// A form the heuristics can't fully read: labels deliberately outside the
// parser's vocabulary. Same template, parameterized values.
function unusualForm(values: { name: string; date: string; phone: string; lab: string }) {
  return [
    [
      item("ABC Optical Lab Slip", 50, 740),
      item("Account Holder:", 50, 700),
      item(values.name, 200, 700),
      item("Written On:", 50, 680),
      item(values.date, 200, 680),
      item("Reach At:", 50, 660),
      item(values.phone, 200, 660),
      item("Send Via:", 50, 640),
      item(values.lab, 200, 640),
      item("Job Kind:", 50, 620),
      item("Frame Order", 200, 620),
    ],
  ];
}

const FORM_A = unusualForm({ name: "Doe, Jane", date: "05/01/2026", phone: "(714) 555-1234", lab: "AXL" });
const FORM_B = unusualForm({ name: "Smith, Robert", date: "06/02/2026", phone: "949-555-6789", lab: "AXL" });

// Two destinations on purpose: with exactly one configured lab the
// heuristic parser auto-assigns it (single-lab fallback), which would
// mask what the learning layer contributes.
const OFFICE_OPTIONS = {
  jobTypes: [{ id: "jt-glasses", label: "Eyeglasses" }],
  destinations: [
    { id: "dest-apex", label: "Apex Lab Co" },
    { id: "dest-sunrise", label: "Sunrise Optics" },
  ],
};

// ── Fingerprint ────────────────────────────────────────────────────────

test("fingerprint: same form with different values hashes identically", () => {
  const a = computeOrderSheetFingerprint(FORM_A);
  const b = computeOrderSheetFingerprint(FORM_B);
  assert.ok(a, "expected a non-empty fingerprint");
  assert.equal(a, b);
});

test("fingerprint: different label sets hash differently", () => {
  const other = [
    [
      item("Patient:", 50, 700),
      item("Doe, Jane", 200, 700),
      item("Order Date:", 50, 680),
      item("05/01/2026", 200, 680),
      item("Phone:", 50, 660),
      item("714-555-1234", 200, 660),
      item("Lab:", 50, 640),
      item("Apex", 200, 640),
    ],
  ];
  assert.notEqual(computeOrderSheetFingerprint(FORM_A), computeOrderSheetFingerprint(other));
});

test("fingerprint: label-poor documents produce no fingerprint", () => {
  const letter = [[item("Dear valued customer,", 50, 700), item("Thanks for your order.", 50, 680)]];
  assert.equal(computeOrderSheetFingerprint(letter), "");
});

// ── Derive ─────────────────────────────────────────────────────────────

const EMPTY_FIELDS = {
  patientFirstName: "",
  patientLastName: "",
  trayNumber: "",
  phone: "",
  jobTypeId: "",
  jobTypeText: "",
  destinationId: "",
  destinationText: "",
  orderDate: "",
  notes: "",
};

test("derive: corrections anchor to the printed label left of the value", () => {
  const rules = deriveOrderSheetAnchorRules(FORM_A, EMPTY_FIELDS, {
    patientFirstName: "Jane",
    patientLastName: "Doe",
    orderDate: "2026-05-01",
    phone: "7145551234",
  });
  const byField = new Map(rules.map((r) => [r.field, r]));
  assert.deepEqual(byField.get("patientName"), { field: "patientName", label: "account holder", position: "right" });
  assert.deepEqual(byField.get("orderDate"), { field: "orderDate", label: "written on", position: "right" });
  assert.deepEqual(byField.get("phone"), { field: "phone", label: "reach at", position: "right" });
});

test("derive: a value that isn't on the sheet teaches nothing", () => {
  const rules = deriveOrderSheetAnchorRules(FORM_A, EMPTY_FIELDS, {
    patientFirstName: "Maria",
    patientLastName: "Garcia",
  });
  assert.equal(rules.length, 0);
});

test("derive: unchanged fields teach nothing", () => {
  const original = { ...EMPTY_FIELDS, patientFirstName: "Jane", patientLastName: "Doe" };
  const rules = deriveOrderSheetAnchorRules(FORM_A, original, {
    patientFirstName: "Jane",
    patientLastName: "Doe",
  });
  assert.equal(rules.length, 0);
});

test("derive: option corrections become raw-text → option-id mappings", () => {
  const original = { ...EMPTY_FIELDS, destinationText: "AXL" };
  const rules = deriveOrderSheetAnchorRules(FORM_A, original, { destinationId: "dest-apex" });
  assert.deepEqual(rules, [
    { field: "destination", label: "", position: "right", valueMap: { axl: "dest-apex" } },
  ]);
});

test("derive: lab also learns an ANCHOR when the option label appears on the sheet", () => {
  // Simulates the user's screenshot: the parser found nothing for "lab"
  // (destinationText is empty), so the old valueMap-only path produced
  // no rule. Now we also try to anchor on the lab's label/aliases.
  const layout = [
    [
      item("Account Holder:", 50, 700),
      item("Doe, Jane", 200, 700),
      item("Written On:", 50, 680),
      item("05/01/2026", 200, 680),
      item("Send Via:", 50, 640),
      // The lab's PRINTED text matches the option label so the matcher
      // can resolve it.
      item("Apex Lab Co", 200, 640),
      item("Job Kind:", 50, 620),
      item("Frame Order", 200, 620),
    ],
  ];
  const rules = deriveOrderSheetAnchorRules(
    layout,
    EMPTY_FIELDS,
    { destinationId: "dest-apex" },
    OFFICE_OPTIONS,
  );
  assert.deepEqual(rules, [{ field: "destination", label: "send via", position: "right" }]);
});

test("derive: lab learning PRODUCES BOTH valueMap and anchor when both signals are present", () => {
  // The parser found raw text ("AXL") AND the lab's option label is
  // resolvable somewhere on the sheet — we should learn both.
  const layout = [
    [
      item("Account Holder:", 50, 700),
      item("Doe, Jane", 200, 700),
      item("Send Via:", 50, 640),
      item("Apex Lab Co", 200, 640),
    ],
  ];
  const original = { ...EMPTY_FIELDS, destinationText: "AXL" };
  const rules = deriveOrderSheetAnchorRules(
    layout,
    original,
    { destinationId: "dest-apex" },
    OFFICE_OPTIONS,
  );
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.find((r) => r.valueMap), {
    field: "destination",
    label: "",
    position: "right",
    valueMap: { axl: "dest-apex" },
  });
  assert.deepEqual(rules.find((r) => r.label === "send via"), {
    field: "destination",
    label: "send via",
    position: "right",
  });
});

test("apply: a stored multi-anchor rule tries each anchor; first valid extract wins", () => {
  // Layout where only the SECOND anchor matches — the first ("account
  // holder") doesn't exist on this sheet variant.
  const layout = [
    [
      item("Account Name:", 50, 700),
      item("Doe, Jane", 200, 700),
      item("Written On:", 50, 680),
      item("05/01/2026", 200, 680),
    ],
  ];
  const stored = [
    {
      field: "patientName",
      label: "",
      position: "right",
      anchors: [
        { label: "account holder", position: "right" },
        { label: "account name", position: "right" },
      ],
    },
  ] as any;
  const result = applyOrderSheetAnchorRules(layout, stored, OFFICE_OPTIONS);
  assert.equal(result.fields.patientFirstName, "Jane");
  assert.equal(result.fields.patientLastName, "Doe");
  assert.deepEqual(result.applied, ["patientName"]);
});

test("apply: lab anchor learned from one sheet resolves the lab on the next sheet", () => {
  // The exact case from the user's screenshot: previously the lab was
  // "missing" and reviewing the sheet didn't fix it. With anchor
  // learning, the next sheet auto-fills the lab from the learned spot.
  const stored = [
    { field: "destination", label: "send via", position: "right" },
  ] as any;
  const result = applyOrderSheetAnchorRules(FORM_A, stored, {
    jobTypes: [{ id: "jt-glasses", label: "Eyeglasses" }],
    destinations: [
      { id: "dest-apex", label: "AXL" }, // The label-as-printed
      { id: "dest-sunrise", label: "Sunrise Optics" },
    ],
  });
  assert.equal(result.fields.destinationId, "dest-apex");
  assert.deepEqual(result.applied, ["destination"]);
});

test("apply: backward-compat — old-shape single-anchor JSON still applies", () => {
  // Pre-anchors-list rows still in the wild: just {label, position}, no
  // `anchors` array.
  const stored = [
    { field: "patientName", label: "account holder", position: "right" },
  ] as any;
  const result = applyOrderSheetAnchorRules(FORM_A, stored, OFFICE_OPTIONS);
  assert.equal(result.fields.patientFirstName, "Jane");
  assert.equal(result.fields.patientLastName, "Doe");
});

test("derive: inline 'Label: value' segments anchor to the inline label", () => {
  const layout = [
    [
      item("Account Holder: Doe, Jane", 50, 700),
      item("Written On:", 50, 680),
      item("05/01/2026", 200, 680),
      item("Reach At:", 50, 660),
      item("Send Via:", 50, 640),
    ],
  ];
  const rules = deriveOrderSheetAnchorRules(layout, EMPTY_FIELDS, {
    patientFirstName: "Jane",
    patientLastName: "Doe",
  });
  assert.deepEqual(rules, [{ field: "patientName", label: "account holder", position: "right" }]);
});

test("derive: column-header forms anchor below the label", () => {
  const layout = [
    [
      item("Account Holder:", 50, 700),
      item("Doe, Jane", 50, 684),
      item("Written On:", 300, 700),
      item("05/01/2026", 300, 684),
      item("Reach At:", 50, 650),
      item("Send Via:", 50, 630),
    ],
  ];
  const rules = deriveOrderSheetAnchorRules(layout, EMPTY_FIELDS, {
    patientFirstName: "Jane",
    patientLastName: "Doe",
    orderDate: "2026-05-01",
  });
  const byField = new Map(rules.map((r) => [r.field, r]));
  assert.deepEqual(byField.get("patientName"), { field: "patientName", label: "account holder", position: "below" });
  assert.deepEqual(byField.get("orderDate"), { field: "orderDate", label: "written on", position: "below" });
});

// ── Apply ──────────────────────────────────────────────────────────────

test("apply: learned rules extract and validate from a new sheet of the same form", () => {
  const rules = deriveOrderSheetAnchorRules(FORM_A, EMPTY_FIELDS, {
    patientFirstName: "Jane",
    patientLastName: "Doe",
    orderDate: "2026-05-01",
    phone: "7145551234",
    destinationId: "dest-apex",
  });
  // destination needs the raw text on the original parse to learn from
  const destRules = deriveOrderSheetAnchorRules(
    FORM_A,
    { ...EMPTY_FIELDS, destinationText: "AXL" },
    { destinationId: "dest-apex" },
  );
  const all = [...rules, ...destRules];

  const { fields, applied } = applyOrderSheetAnchorRules(FORM_B, all, OFFICE_OPTIONS);
  assert.equal(fields.patientFirstName, "Robert");
  assert.equal(fields.patientLastName, "Smith");
  assert.equal(fields.orderDate, "2026-06-02");
  assert.equal(fields.phone, "9495556789");
  assert.equal(fields.destinationId, "dest-apex");
  assert.equal(fields.destinationText, "AXL");
  assert.ok(applied.includes("patientName"));
  assert.ok(applied.includes("destination"));
});

test("apply: option ids that no longer exist in office settings are dropped", () => {
  const rules = [{ field: "destination" as const, label: "", position: "right" as const, valueMap: { axl: "dest-gone" } }];
  const { fields, applied } = applyOrderSheetAnchorRules(FORM_B, rules, OFFICE_OPTIONS);
  assert.equal(fields.destinationId, undefined);
  assert.equal(applied.length, 0);
});

test("apply: garbage at the anchored position is rejected, not guessed", () => {
  // Same labels, but the name cell holds a digit-bearing string.
  const noisy = unusualForm({ name: "1234 Main St", date: "06/02/2026", phone: "949-555-6789", lab: "AXL" });
  const rules = deriveOrderSheetAnchorRules(FORM_A, EMPTY_FIELDS, {
    patientFirstName: "Jane",
    patientLastName: "Doe",
  });
  const { fields } = applyOrderSheetAnchorRules(noisy, rules, OFFICE_OPTIONS);
  assert.equal(fields.patientFirstName, undefined);
  assert.equal(fields.patientLastName, undefined);
});

test("mergeLearnedFields: learned values override, empties never clobber", () => {
  const base = { ...EMPTY_FIELDS, patientFirstName: "Wrong", patientLastName: "Guess", orderDate: "2026-01-01" };
  const merged = mergeLearnedFields(base, { patientFirstName: "Jane", patientLastName: "Doe", phone: "" });
  assert.equal(merged.patientFirstName, "Jane");
  assert.equal(merged.patientLastName, "Doe");
  assert.equal(merged.orderDate, "2026-01-01");
  assert.equal(merged.phone, "");
});

// ── Storage round-trip ─────────────────────────────────────────────────

test("storage: rules upsert per field and merge anchors + valueMaps across corrections", async () => {
  const office = await storage.createOffice({ name: "Learning Optical" } as any);
  const fp = computeOrderSheetFingerprint(FORM_A);

  await storage.upsertOrderSheetTemplateRules(office.id, fp, [
    { field: "patientName", label: "account holder", position: "right" },
    { field: "destination", label: "", position: "right", valueMap: { axl: "dest-apex" } },
  ]);
  // Second correction: patientName anchor learned at a DIFFERENT spot
  // ("account name" on a redesigned form), destination learns another
  // spelling. The first patient anchor must survive — it might still be
  // the only one that matches on sheets printed from the older template.
  await storage.upsertOrderSheetTemplateRules(office.id, fp, [
    { field: "patientName", label: "account name", position: "right" },
    { field: "destination", label: "", position: "right", valueMap: { "apex labs": "dest-apex" } },
  ]);

  const rows = await storage.getOrderSheetTemplates(office.id, fp);
  assert.equal(rows.length, 2);
  const byField = new Map(rows.map((row) => [row.field, row.rule as any]));
  // Both anchors survive — additive, not replacing.
  assert.deepEqual(byField.get("patientName").anchors, [
    { label: "account holder", position: "right" },
    { label: "account name", position: "right" },
  ]);
  // Destination has no anchor (pure valueMap) but value spellings merged.
  assert.deepEqual(byField.get("destination").valueMap, { axl: "dest-apex", "apex labs": "dest-apex" });

  // Re-saving the SAME anchor is a no-op (dedup on label+position).
  await storage.upsertOrderSheetTemplateRules(office.id, fp, [
    { field: "patientName", label: "account name", position: "right" },
  ]);
  const after = await storage.getOrderSheetTemplates(office.id, fp);
  const patientAfter = (after.find((r) => r.field === "patientName")?.rule as any) || {};
  assert.equal(patientAfter.anchors.length, 2);

  // Other offices and other forms see nothing.
  assert.equal((await storage.getOrderSheetTemplates(office.id, "different-fp")).length, 0);
  assert.equal((await storage.getOrderSheetTemplates("other-office", fp)).length, 0);
});

// ── End-to-end through a real PDF ──────────────────────────────────────

// Same xref-correct generator the watcher tests use, extended with
// per-item positions so columns land where the layout logic expects.
function buildPositionedPdf(items: Array<{ str: string; x: number; y: number }>): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = items.map((i) => `BT /F1 11 Tf ${i.x} ${i.y} Td (${esc(i.str)}) Tj ET`).join("\n");
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

function pdfItemsFor(values: { name: string; date: string; phone: string; lab: string }) {
  return [
    { str: "ABC Optical Lab Slip", x: 50, y: 740 },
    { str: "Account Holder:", x: 50, y: 700 },
    { str: values.name, x: 220, y: 700 },
    { str: "Written On:", x: 50, y: 680 },
    { str: values.date, x: 220, y: 680 },
    { str: "Reach At:", x: 50, y: 660 },
    { str: values.phone, x: 220, y: 660 },
    { str: "Send Via:", x: 50, y: 640 },
    { str: values.lab, x: 220, y: 640 },
    { str: "Job Kind:", x: 50, y: 620 },
    { str: "Frame Order", x: 220, y: 620 },
  ];
}

test("end-to-end: review correction on a real PDF teaches the next ingest", async () => {
  const office = await storage.createOffice({ name: "E2E Learning Optical" } as any);

  // Sheet 1 arrives; the heuristics can't read this form's odd labels.
  const pdfA = buildPositionedPdf(
    pdfItemsFor({ name: "Doe, Jane", date: "05/01/2026", phone: "(714) 555-1234", lab: "AXL" }),
  );
  const layoutA = await extractOrderSheetLayoutFromPdf(pdfA);
  assert.ok(layoutA, "expected layout from generated PDF");

  // (Sanity: the heuristic parser alone can't resolve the lab.)
  const heuristic = parseOrderSheet("Send Via:\tAXL", {
    jobTypes: OFFICE_OPTIONS.jobTypes,
    destinations: OFFICE_OPTIONS.destinations,
    identifierMode: "patientName",
  });
  assert.equal(heuristic.fields.destinationId, "");

  // Staff reviews sheet 1: their submitted job is the correction. The
  // import row carries the original parse (destination raw text found
  // but unmapped) and points at the stored attachment.
  const attachmentDir = path.join(TEST_DIR, "order-sheet-attachments");
  fs.mkdirSync(attachmentDir, { recursive: true });
  fs.writeFileSync(path.join(attachmentDir, "import-1.pdf"), pdfA);

  const { learnedFields } = await learnFromOrderSheetCorrection({
    storage,
    importRecord: {
      id: "import-1",
      officeId: office.id,
      parsed: { fields: { ...EMPTY_FIELDS, destinationText: "AXL" }, missing: [] },
      attachmentPath: path.posix.join("order-sheet-attachments", "import-1.pdf"),
    },
    corrected: {
      patientFirstName: "Jane",
      patientLastName: "Doe",
      orderDate: "2026-05-01",
      phone: "7145551234",
      destinationId: "dest-apex",
    },
  });
  assert.ok(learnedFields.includes("patientName"), `learned: ${learnedFields.join(", ")}`);
  assert.ok(learnedFields.includes("destination"), `learned: ${learnedFields.join(", ")}`);

  // Sheet 2 (same form, new patient) ingests: learned rules fill what the
  // heuristics can't, and the merged result is confident.
  const pdfB = buildPositionedPdf(
    pdfItemsFor({ name: "Smith, Robert", date: "06/02/2026", phone: "949-555-6789", lab: "AXL" }),
  );
  const layoutB = await extractOrderSheetLayoutFromPdf(pdfB);
  assert.ok(layoutB);

  const learned = await applyLearnedOrderSheetTemplates({
    storage,
    officeId: office.id,
    layout: layoutB!,
    options: OFFICE_OPTIONS,
  });
  assert.equal(learned.fields.patientFirstName, "Robert");
  assert.equal(learned.fields.patientLastName, "Smith");
  assert.equal(learned.fields.orderDate, "2026-06-02");
  assert.equal(learned.fields.phone, "9495556789");
  assert.equal(learned.fields.destinationId, "dest-apex");

  const merged = mergeLearnedFields({ ...EMPTY_FIELDS, jobTypeId: "jt-glasses" }, learned.fields);
  assert.deepEqual(computeMissingOrderSheetFields(merged, "patientName"), []);
});

// ── changedLearnableFields ──────────────────────────────────────────────

test("changedLearnableFields: reports only the fields the user actually changed", () => {
  const original = {
    ...EMPTY_FIELDS,
    patientFirstName: "Jane",
    patientLastName: "Doe",
    phone: "7145551234",
    destinationId: "dest-apex",
  };
  // User fixes the lab and the phone, leaves the name alone.
  const changed = changedLearnableFields(original, {
    patientFirstName: "Jane",
    patientLastName: "Doe",
    phone: "9995551234",
    destinationId: "dest-sunrise",
  });
  assert.ok(changed.includes("phone"));
  assert.ok(changed.includes("destination"));
  assert.ok(!changed.includes("patientName"));
});

// ── self-healing: drop a stale learned rule on re-correction ────────────

test("learnFromOrderSheetCorrection drops a learned rule the user re-corrects but we can't re-derive", async () => {
  const office = await storage.createOffice({ name: "Self-Heal Optical" } as any);

  // Teach a (wrong, as it'll turn out) patientName anchor for this form.
  const pdf = buildPositionedPdf(pdfItemsFor({ name: "Doe, Jane", date: "05/01/2026", phone: "(714) 555-1234", lab: "AXL" }));
  const layout = await extractOrderSheetLayoutFromPdf(pdf);
  assert.ok(layout);
  const fp = computeOrderSheetFingerprint(layout!);
  await storage.upsertOrderSheetTemplateRules(office.id, fp, [
    { field: "patientName", label: "account holder", position: "right" },
  ]);
  assert.equal((await storage.getOrderSheetTemplates(office.id, fp)).some((r) => r.field === "patientName"), true);

  // Stage the attachment so the learner can read the layout.
  const dir = path.join(TEST_DIR, "order-sheet-attachments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "heal-1.pdf"), pdf);

  // The sheet was filled FROM that learned rule (learnedFields), but the
  // user corrects the name to something NOT printed on the sheet — so no
  // fresh rule can be derived. The stale rule must be dropped.
  const { learnedFields, droppedFields } = await learnFromOrderSheetCorrection({
    storage,
    importRecord: {
      id: "heal-1",
      officeId: office.id,
      parsed: { fields: { ...EMPTY_FIELDS, patientFirstName: "Doe", patientLastName: "Jane" }, learnedFields: ["patientName"] },
      attachmentPath: path.posix.join("order-sheet-attachments", "heal-1.pdf"),
    },
    corrected: { patientFirstName: "Margaret", patientLastName: "Hollanaway-Notonthissheet" },
  });
  assert.deepEqual(learnedFields, []);
  assert.ok(droppedFields.includes("patientName"), `dropped: ${droppedFields.join(", ")}`);
  assert.equal((await storage.getOrderSheetTemplates(office.id, fp)).some((r) => r.field === "patientName"), false);
});

// ── office-wide reset ───────────────────────────────────────────────────

test("deleteAllOrderSheetTemplates clears every learned rule for the office only", async () => {
  const office = await storage.createOffice({ name: "Reset Optical" } as any);
  const other = await storage.createOffice({ name: "Untouched Optical" } as any);
  await storage.upsertOrderSheetTemplateRules(office.id, "fp-a", [{ field: "phone", label: "reach at", position: "right" }]);
  await storage.upsertOrderSheetTemplateRules(office.id, "fp-b", [{ field: "orderDate", label: "written on", position: "right" }]);
  await storage.upsertOrderSheetTemplateRules(other.id, "fp-a", [{ field: "phone", label: "reach at", position: "right" }]);

  const cleared = await storage.deleteAllOrderSheetTemplates(office.id);
  assert.equal(cleared, 2);
  assert.equal((await storage.getOrderSheetTemplates(office.id, "fp-a")).length, 0);
  assert.equal((await storage.getOrderSheetTemplates(office.id, "fp-b")).length, 0);
  // Other office untouched.
  assert.equal((await storage.getOrderSheetTemplates(other.id, "fp-a")).length, 1);
});
