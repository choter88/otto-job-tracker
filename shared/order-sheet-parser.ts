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

const TYPE_LABEL = /^(?:order\s*type|job\s*(?:type|kind)|type|product(?:\s*type)?|order)$/i;

const DESTINATION_LABEL = /^(?:lab(?:oratory)?(?:\s*name)?|destination|send\s*(?:to|via)|ship\s*(?:to|via)|vendor|supplier|order\s*destination)$/i;

const NOTES_LABEL = /^(?:notes?|comments?|special\s*instructions?|instructions?|remarks?)$/i;

// ── Helpers ────────────────────────────────────────────────────────────

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Words that mark a string as a document title or section header rather
// than a person's name. EHRs often print the title in the same band as
// the "Patient:" label, and a Y-coordinate quirk can land them on the
// same row — without this guard the parser would happily declare
// "Contact Lens Order" the patient.
const PATIENT_NAME_TITLE_BLOCKLIST =
  /\b(order|sheet|form|invoice|receipt|prescription|rx|lens|frame|sunglass|contact|product|sale|claim)\b/i;

// Common EHR aliases for job-type CATEGORIES. The key is matched against
// the office's configured option labels (e.g. an office whose glasses
// option is called "Frames" or "Eyewear" still matches "Frame Order").
// Each entry: a regex against the office's option LABEL → a regex
// against the SHEET TEXT that should map to that option.
const JOB_TYPE_ALIASES: Array<{ optionLabel: RegExp; sheetText: RegExp }> = [
  // "Frame Order", "Frame Sale", "spectacles" → office's glasses-like option
  { optionLabel: /\b(glass|frame|spectacle|eyewear)/i, sheetText: /\bframe(?:s|d)?\s*(?:order|sale)?\b/i },
  // "Contact Lens", "Contact Lens Order" → office's contacts-like option
  { optionLabel: /\bcontact/i, sheetText: /\bcontact\s*lens(?:es)?\b/i },
  // "Sunglass Order" → office's sunglasses-like option
  { optionLabel: /\bsunglass/i, sheetText: /\bsun\s*glass(?:es)?\b/i },
];

// Common EHR aliases for lab/destination names. Lab abbreviations vary
// wildly between EHR exports and clinic configurations ("B+L" vs
// "Bausch & Lomb" vs "Bausch+Lomb"), so we ship a short list of the
// names that won't survive plain token matching.
const LAB_ALIASES: Array<{ optionLabel: RegExp; sheetText: RegExp }> = [
  { optionLabel: /\bb\s*\+?\s*l\b|bausch/i, sheetText: /\bbausch\s*(?:&|and|\+)\s*lomb\b|\bb\s*\+\s*l\b/i },
  { optionLabel: /\bj\s*&?\s*j|johnson/i, sheetText: /\bj\s*&\s*j\b|\bjohnson\s*&\s*johnson\b/i },
  { optionLabel: /\bcoopervision|cooper/i, sheetText: /\bcooper\s*vision\b|\bcoopervision\b/i },
  { optionLabel: /\balcon\b/i, sheetText: /\balcon\b/i },
];

function findAliasMatch(
  lines: string[],
  options: OrderSheetOption[],
  aliases: typeof JOB_TYPE_ALIASES,
): { id: string; text: string } {
  for (const line of lines) {
    for (const alias of aliases) {
      if (alias.sheetText.test(line)) {
        const opt = options.find((o) => alias.optionLabel.test(o.label));
        if (opt) return { id: opt.id, text: opt.label };
      }
    }
  }
  return { id: "", text: "" };
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

// A segment that's nothing but "Label:" or "Label" with no value attached.
// Used to detect the label-tab-value layout where pdf.js gives us the
// label and value as separate tabular cells.
const LABEL_ONLY_RE = /^([A-Za-z][A-Za-z./#' ]{0,40}?)\s*[:：]\s*$/;
// Phone labels often appear without a colon ("Contact # (555) 123-4567"
// in Crystal PM). The tabular reconstruction now splits these into two
// segments; we recognize phone-shaped labels for cross-segment pairing.
const PHONE_LABEL_ONLY_RE = /^(?:patient\s*)?(?:phone|cell|mobile|telephone|tel|contact)\s*#?$/i;

/**
 * Break a line of sheet text into label/value pairs.
 *
 * Real-world forms come in two flavors that this needs to handle:
 *
 *  (a) Label and value live in ONE segment, separated by `:` —
 *      "Patient: Jane Doe    DOB: 01/02/1980". The wide-whitespace
 *      split breaks each printed field into its own segment; the
 *      label:value regex then matches.
 *
 *  (b) Label and value live in ADJACENT segments separated by a tab,
 *      with the label segment ending in `:` and no value attached —
 *      "Patient:" \t "Jane Doe" \t "Order Date:" \t "04/28/2025".
 *      This is how Crystal PM (and other column-laid-out EHRs) come
 *      out of pdf.js once the watcher's column-aware line
 *      reconstruction inserts tabs at real column boundaries. We
 *      handle this with a label-only check + lookahead at the next
 *      segment.
 *
 * Phone labels often skip the colon entirely ("Contact # (555) …");
 * we accept that pattern too when the next segment looks like a value.
 */
function extractPairs(line: string): LabeledPair[] {
  const pairs: LabeledPair[] = [];
  const segments = line.split(/\t+|\s{2,}/).map((segment) => segment.trim()).filter(Boolean);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // (a) Label and value inline within the same segment.
    const inline = segment.match(/^([A-Za-z][A-Za-z./#' ]{0,40}?)\s*[:：]\s*(.+)$/);
    if (inline) {
      pairs.push({ label: inline[1].trim(), value: inline[2].trim() });
      continue;
    }

    // (b) Label-only segment paired with the next segment as value.
    //     We skip if the next segment is itself another label, which
    //     happens when a form's column header line lists labels in a
    //     row ("Lab Contact # \t Lab Order #").
    const labelOnly = segment.match(LABEL_ONLY_RE);
    if (labelOnly && i + 1 < segments.length) {
      const next = segments[i + 1];
      if (!LABEL_ONLY_RE.test(next) && !PHONE_LABEL_ONLY_RE.test(next)) {
        pairs.push({ label: labelOnly[1].trim(), value: next });
        i += 1; // consume the value segment
        continue;
      }
    }

    // Phone label without a trailing colon ("Contact #").
    if (PHONE_LABEL_ONLY_RE.test(segment) && i + 1 < segments.length) {
      const next = segments[i + 1];
      if (!LABEL_ONLY_RE.test(next) && !PHONE_LABEL_ONLY_RE.test(next)) {
        pairs.push({ label: segment, value: next });
        i += 1;
        continue;
      }
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

  // Track the strict "Order Date" specifically so it always wins over
  // looser date labels (Dispense Date / Expected Date / bare "Date"),
  // which all match ORDER_DATE_LABEL but represent different concepts.
  // Without this, the first date label found linearly wins — and
  // Dispense Date sometimes appears earlier in the extracted text than
  // Order Date.
  let strictOrderDate = "";
  let looseOrderDate = "";

  for (const line of lines) {
    for (const { label, value } of extractPairs(line)) {
      if (!value) continue;

      if (
        !fields.patientLastName &&
        PATIENT_LABEL.test(label) &&
        !PATIENT_LABEL_BLOCKLIST.test(label) &&
        // Reject document-title-shaped values that collided with the
        // Patient: label on the same printed row ("Patient: Contact
        // Lens Order"). The real patient name lands either as a later
        // pair or via the standalone-name fallback below.
        !PATIENT_NAME_TITLE_BLOCKLIST.test(value)
      ) {
        const { first, last } = splitPatientName(value);
        fields.patientFirstName = first;
        fields.patientLastName = last;
        continue;
      }

      // DOB must be consumed BEFORE the order-date extractor so a bare
      // "Date" label never swallows a birth date, and vice versa.
      if (DOB_LABEL.test(label)) continue;

      if (ORDER_DATE_LABEL.test(label)) {
        const parsed = parseSheetDate(value);
        if (parsed) {
          if (/^order\s*date$/i.test(label.trim())) {
            if (!strictOrderDate) strictOrderDate = parsed;
          } else if (!looseOrderDate) {
            looseOrderDate = parsed;
          }
        }
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

  // Apply the date precedence: strict "Order Date" wins; otherwise the
  // looser dispense/expected/etc-date matches.
  fields.orderDate = strictOrderDate || looseOrderDate;

  // Patient-name standalone fallback: if no labeled "Patient:" line
  // produced a valid name (or the value was a title we rejected), scan
  // every line AND its segments for a bare "Last, First" pattern. Forms
  // with column drift often park the name in its own cell with the
  // label in a different cell altogether ("test, test \t To:"), so the
  // segment-level scan is what catches them. We reject digit-containing
  // segments to keep city/state/zip lines like "test, CA 92866" from
  // counting as a person.
  if (!fields.patientLastName) {
    const namePattern = /^([A-Za-z][A-Za-z'-]{1,40})\s*,\s*([A-Za-z][A-Za-z'-]{1,40}(?:\s+[A-Za-z]\.?){0,2})$/;
    outer: for (const line of lines) {
      if (PATIENT_NAME_TITLE_BLOCKLIST.test(line)) continue;
      const segments = line.split(/\t+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
      for (const segment of segments) {
        if (/\d/.test(segment)) continue;
        if (PATIENT_NAME_TITLE_BLOCKLIST.test(segment)) continue;
        if (namePattern.test(segment)) {
          const { first, last } = splitPatientName(segment);
          fields.patientFirstName = first;
          fields.patientLastName = last;
          break outer;
        }
      }
    }
  }

  // Phone fallback: if no labeled phone landed, scan all lines for a
  // 10-digit-pattern outside any "DOB" / "Acct ID" context. Some forms
  // print the number with no label adjacency at all.
  if (!fields.phone) {
    for (const line of lines) {
      if (/\b(dob|d\.o\.b|date of birth|acct|account|order|invoice|tray)\b/i.test(line)) continue;
      const m = line.match(/\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
      if (m) {
        fields.phone = `${m[1]}${m[2]}${m[3]}`;
        break;
      }
    }
  }

  // Fallbacks for job type and lab. For the SCAN-by-option-label step we
  // strip lines that are nothing but phone-label adjacencies, since
  // "Contact #" plus a phone number is the most common way the bare
  // word "contact" sneaks in and false-matches a "Contacts" job type.
  const linesForOptionScan = lines.filter(
    (line) => !/\b(?:phone|cell|mobile|telephone|tel|contact)\s*#?\s*[:：]?\s*\(?\d/i.test(line),
  );

  // EHR alias scan FIRST: a specific pattern like "Frame Order" or
  // "Contact Lens" is a much stronger signal than the generic
  // single-word token scan, which can false-match on a bare "Contact"
  // appearing in some unrelated header. Aliases run first so the right
  // answer wins before the loose scan gets a chance to mislabel.
  if (!fields.jobTypeId) {
    const alias = findAliasMatch(linesForOptionScan, options.jobTypes, JOB_TYPE_ALIASES);
    if (alias.id) {
      fields.jobTypeId = alias.id;
      if (!fields.jobTypeText) fields.jobTypeText = alias.text;
    }
  }
  if (!fields.jobTypeId) {
    const scan = scanLinesForOption(linesForOptionScan, options.jobTypes);
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
  if (!fields.destinationId) {
    const alias = findAliasMatch(lines, options.destinations, LAB_ALIASES);
    if (alias.id) {
      fields.destinationId = alias.id;
      if (!fields.destinationText) fields.destinationText = alias.text;
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

  const missing = computeMissingOrderSheetFields(fields, options.identifierMode);

  return { fields, missing, confident: missing.length === 0 };
}

/**
 * Which required fields are still unresolved. Exported separately from
 * parseOrderSheet so callers that post-process the fields (e.g. merging
 * learned template extractions over the heuristic result) can recompute
 * missing/confident with the exact same rules.
 */
export function computeMissingOrderSheetFields(
  fields: ParsedOrderSheetFields,
  identifierMode: "patientName" | "trayNumber",
): string[] {
  const missing: string[] = [];
  if (identifierMode === "trayNumber") {
    if (!fields.trayNumber) missing.push("tray number");
  } else {
    if (!fields.patientFirstName || !fields.patientLastName) missing.push("patient name");
  }
  if (!fields.jobTypeId) missing.push("order type");
  if (!fields.destinationId) missing.push("lab");
  return missing;
}
