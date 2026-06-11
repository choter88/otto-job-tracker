// Order-sheet field extraction.
//
// Takes the raw text of a frame order sheet (already extracted from the
// PDF/text file by the desktop watcher) and pulls out the fields Otto
// needs to create a job: patient name, tray number, phone, order type,
// lab/destination, and order date.
//
// Design constraints:
// - Order sheets come from many different EHR/optical-POS systems, so this
//   is a label-dictionary heuristic, not a fixed template. Every extractor
//   is independent; a sheet that only yields some fields still produces a
//   useful partial result.
// - The parser NEVER guesses when the office's own configured lists are
//   authoritative: order type and destination must resolve to one of the
//   office's configured options or they stay unmatched (→ needs review).
// - Pure function of (text, office options) — no I/O, no Date.now() except
//   for future-date sanity checks — so it's unit-testable and runs the
//   same on the server and in the renderer.

export interface OrderSheetOption {
  id: string;
  label: string;
}

export interface ParseOrderSheetOptions {
  /** Office's configured job types (settings.customJobTypes). */
  jobTypes: OrderSheetOption[];
  /** Office's configured labs/destinations (settings.customOrderDestinations). */
  destinations: OrderSheetOption[];
  /** Office identifier mode — decides which fields are required. */
  identifierMode: "patientName" | "trayNumber";
  /** Injectable "today" for tests; defaults to the real clock. */
  now?: Date;
}

export interface ParsedOrderSheetFields {
  patientFirstName: string;
  patientLastName: string;
  trayNumber: string;
  /** Digits only, matching how the app stores phone numbers. */
  phone: string;
  /** Matched office job type id, or "" when nothing matched. */
  jobTypeId: string;
  /** Raw order-type text found on the sheet (shown in review UI). */
  jobTypeText: string;
  /** Matched office destination id, or "" when nothing matched. */
  destinationId: string;
  /** Raw lab/destination text found on the sheet. */
  destinationText: string;
  /** ISO date (yyyy-mm-dd) of the order, or "" when not found. */
  orderDate: string;
  /** Free-text notes/special instructions found on the sheet. */
  notes: string;
}

export interface OrderSheetParseResult {
  fields: ParsedOrderSheetFields;
  /**
   * Human-readable names of required fields that could not be extracted
   * or matched. Empty ⇔ `confident` is true.
   */
  missing: string[];
  /** True when every required field resolved — safe to auto-create a job. */
  confident: boolean;
}

// ── Label dictionaries ─────────────────────────────────────────────────
//
// Each entry is a regex matched against the LABEL part of a `label: value`
// pair (case-insensitive, already trimmed). Order matters only for the
// negative guards below — extraction itself is first-match-wins per field.

const PATIENT_LABEL = /^(?:patient(?:\s*name)?|pt\.?(?:\s*name)?|name|customer(?:\s*name)?|account(?:\s*name)?)$/i;
// Lines like "Doctor Name", "Provider", "Frame Name" must never feed the
// patient-name extractor even though they end in "name".
const PATIENT_LABEL_BLOCKLIST = /\b(?:doctor|dr|provider|physician|od|staff|user|employee|insurance|frame|lens|lab|vendor|supplier|office|store|company|brand)\b/i;

const DOB_LABEL = /^(?:dob|d\.o\.b\.?|date\s*of\s*birth|birth\s*date|birthdate)$/i;

const ORDER_DATE_LABEL =
  /^(?:(?:order|ordered|sale|sold|invoice|transaction|dispense[d]?|promise[d]?)\s*date|date\s*(?:of\s*order|ordered|of\s*sale|sold)|order\s*placed|date)$/i;

const PHONE_LABEL = /^(?:(?:patient\s*)?(?:phone|cell|mobile|telephone|tel|contact)(?:\s*(?:#|no\.?|num(?:ber)?))?(?:\s*\((?:home|cell|work|mobile)\))?)$/i;

const TRAY_LABEL = /^(?:tray|job\s*tray)(?:\s*(?:#|no\.?|num(?:ber)?|id))?$/i;

const TYPE_LABEL = /^(?:order\s*type|job\s*type|type|product(?:\s*type)?|order)$/i;

const DESTINATION_LABEL = /^(?:lab(?:oratory)?(?:\s*name)?|destination|send\s*to|ship\s*to|vendor|supplier|order\s*destination)$/i;

const NOTES_LABEL = /^(?:notes?|comments?|special\s*instructions?|instructions?|remarks?)$/i;

// ── Helpers ────────────────────────────────────────────────────────────

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Token equality with light plural tolerance: order sheets say "FRAME
// ORDER" while offices configure the type as "Frames" — those must meet
// in the middle without dragging in a stemming library.
function tokensMatch(a: string, b: string): boolean {
  return a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
}

function tokenSubset(needles: string[], haystack: string[]): boolean {
  if (!needles.length) return false;
  return needles.every((needle) => haystack.some((token) => tokensMatch(needle, token)));
}

/**
 * Match free text from the sheet against an office-configured option list.
 *
 * Tiers (strongest first):
 *  1. exact normalized equality ("Frame Only" === "frame only")
 *  2. containment either way ("Frames" appears in "Sunglasses Frames")
 *  3. token overlap with plural tolerance — every token of the shorter
 *     side appears in the longer ("frame" matches "Frames")
 *
 * Returns "" when nothing clears the bar; we'd rather send a sheet to
 * review than guess the wrong type/lab.
 */
export function matchOption(rawText: string, options: OrderSheetOption[]): string {
  const candidate = normalizeForMatch(rawText);
  if (!candidate) return "";

  for (const option of options) {
    if (normalizeForMatch(option.label) === candidate) return option.id;
  }

  for (const option of options) {
    const label = normalizeForMatch(option.label);
    if (!label) continue;
    if (label.includes(candidate) || candidate.includes(label)) return option.id;
  }

  const candidateTokens = candidate.split(" ").filter(Boolean);
  for (const option of options) {
    const labelTokens = normalizeForMatch(option.label).split(" ").filter(Boolean);
    if (!labelTokens.length || !candidateTokens.length) continue;
    const [shorter, longer] =
      labelTokens.length <= candidateTokens.length
        ? [labelTokens, candidateTokens]
        : [candidateTokens, labelTokens];
    if (tokenSubset(shorter, longer)) return option.id;
  }

  return "";
}

/**
 * Scan whole lines for an option label appearing anywhere — fallback for
 * sheets without a labeled "Type:" field (e.g. a big "FRAME ORDER" title
 * resolving to the office's "Frames" type). Options with more tokens win
 * so "Sunglasses Frames" beats "Frames" on the same line.
 */
function scanLinesForOption(lines: string[], options: OrderSheetOption[]): { id: string; text: string } {
  const sorted = [...options]
    .map((option) => ({ option, tokens: normalizeForMatch(option.label).split(" ").filter(Boolean) }))
    .filter((entry) => entry.tokens.length > 0)
    .sort((a, b) => b.tokens.length - a.tokens.length || b.option.label.length - a.option.label.length);

  for (const line of lines) {
    const lineTokens = normalizeForMatch(line).split(" ").filter(Boolean);
    if (!lineTokens.length) continue;
    for (const { option, tokens } of sorted) {
      if (tokenSubset(tokens, lineTokens)) {
        return { id: option.id, text: option.label };
      }
    }
  }
  return { id: "", text: "" };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse common US date formats to ISO yyyy-mm-dd, or "" when invalid. */
export function parseSheetDate(raw: string): string {
  const text = raw.trim();
  if (!text) return "";

  let year = 0;
  let month = 0;
  let day = 0;

  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
  }

  if (!year) {
    m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (m) {
      month = Number(m[1]); day = Number(m[2]); year = Number(m[3]);
      if (year < 100) year += year >= 70 ? 1900 : 2000;
    }
  }

  if (!year) {
    m = text.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
    if (m) {
      month = MONTHS[m[1].slice(0, 3).toLowerCase()] || 0;
      day = Number(m[2]); year = Number(m[3]);
    }
  }

  if (!year || !month || !day) return "";
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return "";

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Split a raw patient-name value into { first, last }.
 * Handles "Last, First", "First Last", "First M. Last", and trailing
 * parentheticals like "(DOB 01/02/1980)".
 */
export function splitPatientName(raw: string): { first: string; last: string } {
  let text = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  // Cut anything after a second label that leaked into the value
  // ("Jane Doe DOB" → "Jane Doe").
  text = text.replace(/\b(?:dob|d\.o\.b|date of birth|phone|cell|acct|account|id)\b.*$/i, "").trim();
  if (!text) return { first: "", last: "" };

  if (text.includes(",")) {
    const [lastPart, firstPart = ""] = text.split(",", 2).map((part) => part.trim());
    const firstTokens = firstPart.split(" ").filter(Boolean);
    return { first: firstTokens[0] || "", last: lastPart };
  }

  const tokens = text.split(" ").filter(Boolean);
  if (tokens.length === 1) return { first: tokens[0], last: "" };

  const first = tokens[0];
  let rest = tokens.slice(1);
  // Drop a middle initial ("M" / "M.") so it doesn't glue onto the last name.
  if (rest.length > 1 && /^[A-Za-z]\.?$/.test(rest[0])) rest = rest.slice(1);
  return { first, last: rest.join(" ") };
}

/** Extract a 10+ digit US phone number; returns digits only. */
function parsePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(0, 10) : "";
}

interface LabeledPair {
  label: string;
  value: string;
}

/**
 * Break a line of sheet text into label/value pairs.
 *
 * Sheets routinely put several fields on one printed row
 * ("Patient: Jane Doe    DOB: 01/02/1980"), which the PDF text layer
 * preserves as wide gaps or tabs — so we split on those first, then on
 * a conservative `label: value` regex within each segment.
 */
function extractPairs(line: string): LabeledPair[] {
  const pairs: LabeledPair[] = [];
  const segments = line.split(/\t+|\s{2,}/).map((segment) => segment.trim()).filter(Boolean);

  for (const segment of segments) {
    // `label : value` — label is 1-4 words (letters / # / .), value is the rest.
    const m = segment.match(/^([A-Za-z][A-Za-z./#' ]{0,40}?)\s*[:：]\s*(.+)$/);
    if (m) {
      pairs.push({ label: m[1].trim(), value: m[2].trim() });
    }
  }

  // A row like "Tray # 142" without a colon still deserves a shot.
  if (pairs.length === 0) {
    const m = line.trim().match(/^(tray(?:\s*(?:#|no\.?|num(?:ber)?))?)\s+(\S+)$/i);
    if (m) pairs.push({ label: m[1], value: m[2] });
  }

  return pairs;
}

// ── Main entry point ───────────────────────────────────────────────────

export function parseOrderSheet(text: string, options: ParseOrderSheetOptions): OrderSheetParseResult {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const fields: ParsedOrderSheetFields = {
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

  for (const line of lines) {
    for (const { label, value } of extractPairs(line)) {
      if (!value) continue;

      if (
        !fields.patientLastName &&
        PATIENT_LABEL.test(label) &&
        !PATIENT_LABEL_BLOCKLIST.test(label)
      ) {
        const { first, last } = splitPatientName(value);
        fields.patientFirstName = first;
        fields.patientLastName = last;
        continue;
      }

      // DOB must be consumed BEFORE the order-date extractor so a bare
      // "Date" label never swallows a birth date, and vice versa.
      if (DOB_LABEL.test(label)) continue;

      if (!fields.orderDate && ORDER_DATE_LABEL.test(label)) {
        fields.orderDate = parseSheetDate(value);
        continue;
      }

      if (!fields.phone && PHONE_LABEL.test(label)) {
        fields.phone = parsePhone(value);
        continue;
      }

      if (!fields.trayNumber && TRAY_LABEL.test(label)) {
        const tray = value.match(/^[\w-]+/)?.[0] || "";
        fields.trayNumber = tray;
        continue;
      }

      if (!fields.jobTypeId && TYPE_LABEL.test(label)) {
        const id = matchOption(value, options.jobTypes);
        // Keep the raw text even when unmatched — the review dialog shows
        // it so staff can see what the sheet said.
        if (!fields.jobTypeText) fields.jobTypeText = value;
        if (id) fields.jobTypeId = id;
        continue;
      }

      if (!fields.destinationId && DESTINATION_LABEL.test(label)) {
        const id = matchOption(value, options.destinations);
        if (!fields.destinationText) fields.destinationText = value;
        if (id) fields.destinationId = id;
        continue;
      }

      if (!fields.notes && NOTES_LABEL.test(label)) {
        fields.notes = value;
        continue;
      }
    }
  }

  // Fallbacks: a title like "FRAME ORDER" or a lab name printed without a
  // label still resolves against the office's configured lists.
  if (!fields.jobTypeId) {
    const scan = scanLinesForOption(lines, options.jobTypes);
    if (scan.id) {
      fields.jobTypeId = scan.id;
      if (!fields.jobTypeText) fields.jobTypeText = scan.text;
    }
  }
  if (!fields.destinationId) {
    const scan = scanLinesForOption(lines, options.destinations);
    if (scan.id) {
      fields.destinationId = scan.id;
      if (!fields.destinationText) fields.destinationText = scan.text;
    }
  }

  // An office with exactly one configured lab sends everything there — no
  // point bouncing the sheet to review over a field with only one answer.
  if (!fields.destinationId && options.destinations.length === 1) {
    fields.destinationId = options.destinations[0].id;
    fields.destinationText = fields.destinationText || options.destinations[0].label;
  }

  // Order dates in the future are misparses (wrong label, OCR noise) —
  // drop them and let the job default to "today" instead.
  if (fields.orderDate) {
    const now = options.now || new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (fields.orderDate > todayIso) fields.orderDate = "";
  }

  const missing: string[] = [];
  if (options.identifierMode === "trayNumber") {
    if (!fields.trayNumber) missing.push("tray number");
  } else {
    if (!fields.patientFirstName || !fields.patientLastName) missing.push("patient name");
  }
  if (!fields.jobTypeId) missing.push("order type");
  if (!fields.destinationId) missing.push("lab");

  return { fields, missing, confident: missing.length === 0 };
}
