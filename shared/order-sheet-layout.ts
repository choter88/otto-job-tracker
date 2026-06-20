// Layout-based order-sheet learning ("the parser remembers your fixes").
//
// The heuristic parser (order-sheet-parser.ts) works on reconstructed
// TEXT and covers the common label vocabulary. This module works on the
// positioned text items pdf.js extracts (x/y/width/fontSize per run) and
// covers everything the heuristics can't know: WHERE a particular office's
// form prints each field. The flow:
//
//   1. fingerprint — a form's static labels ("Patient Name:", "Order
//      Date:", …) form a stable signature. Sheets printed from the same
//      EHR template fingerprint identically even though every value on
//      them differs.
//   2. derive — when staff corrects a reviewed sheet, locate the value
//      they typed in the sheet's layout and record which printed label
//      it sits next to (an "anchor rule"). No new UI: the correction the
//      user already makes in the review dialog IS the teaching signal.
//   3. apply — on the next sheet with the same fingerprint, extract each
//      learned field from its anchored position before falling back to
//      the heuristics.
//
// Everything here is pure geometry + string work (no node/electron/DOM
// APIs) so it runs identically under `node --test`, in the Electron-main
// Express server, and anywhere else.

import {
  matchOption,
  parseSheetDate,
  splitPatientName,
  type OrderSheetOption,
  type ParsedOrderSheetFields,
} from "./order-sheet-parser";

/** One positioned text run, as extracted by pdf.js getTextContent(). */
export interface OrderSheetLayoutItem {
  str: string;
  /** PDF user-space coordinates; origin bottom-left, so larger y = higher. */
  x: number;
  y: number;
  /** Rendered width of the run. */
  w: number;
  /** Font size — used to decide whether a horizontal gap is a column break. */
  fs: number;
}

export type OrderSheetLayoutPage = OrderSheetLayoutItem[];
export type OrderSheetLayout = OrderSheetLayoutPage[];

/** Fields the learning system can anchor. `patientName` covers first+last —
 * they live together on the printed sheet. Option fields (job type / lab)
 * learn text→option-id mappings instead of geometry. */
export type OrderSheetLearnableField =
  | "patientName"
  | "trayNumber"
  | "phone"
  | "orderDate"
  | "jobType"
  | "destination";

export interface OrderSheetAnchorRule {
  field: OrderSheetLearnableField;
  /** Normalized text of the printed label the value sits next to ("" for
   * pure value-map rules on option fields). Old-shape rules use this as
   * their single search location; new-shape rules also accept `anchors`. */
  label: string;
  /** Where the value lives relative to that label. */
  position: "right" | "below";
  /** Additional learned locations (label + position). Each correction
   * appends here instead of replacing the previous anchor, so the same
   * field can be searched at every spot the office has taught Otto over
   * time. First valid extract wins. */
  anchors?: Array<{ label: string; position: "right" | "below" }>;
  /** Option fields only: normalized sheet text → office option id. */
  valueMap?: Record<string, string>;
}

/** Normalize a stored rule (which may be old-shape single-anchor, new-
 * shape multi-anchor, or pure value-map) into the list of label+position
 * anchors to try during apply. */
function anchorsForApply(
  rule: OrderSheetAnchorRule,
): Array<{ label: string; position: "right" | "below" }> {
  const out: Array<{ label: string; position: "right" | "below" }> = [];
  const seen = new Set<string>();
  const push = (anchor: { label: string; position: "right" | "below" } | undefined) => {
    if (!anchor || !anchor.label) return;
    const key = `${anchor.label}|${anchor.position}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: anchor.label, position: anchor.position });
  };
  if (rule.label) push({ label: rule.label, position: rule.position });
  if (Array.isArray(rule.anchors)) for (const anchor of rule.anchors) push(anchor);
  return out;
}

// Same row/column reconstruction thresholds the desktop watcher uses for
// its line text — keep them in lockstep so geometry decisions agree with
// what the heuristic parser saw.
const Y_TOLERANCE_PX = 3;
const COLUMN_GAP_FACTOR = 1.2;

// Mirrors the parser's normalizeForMatch — labels and learned value-map
// keys must normalize identically on both the derive and apply sides.
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Digits-only US phone, same contract as the parser's parsePhone. */
function phoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(0, 10) : "";
}

// "Patient Name:" / "Contact #" — a printed form label with no value in
// the same segment. The fingerprint is built from these.
const SEGMENT_LABEL_RE = /^([A-Za-z][A-Za-z./#'() ]{0,40}?)\s*[:：]$/;
const SEGMENT_HASH_LABEL_RE = /^[A-Za-z][A-Za-z ./']{0,30}#$/;
// "Patient Name: Jane Doe" — label and value in one segment.
const INLINE_PAIR_RE = /^([A-Za-z][A-Za-z./#'() ]{0,40}?)\s*[:：]\s+(.+)$/;

interface Segment {
  text: string;
  x0: number;
  x1: number;
  y: number;
  page: number;
  /** Index of this segment's row within its page (top to bottom). */
  rowIndex: number;
}

function isLabelSegment(segment: Segment): boolean {
  return SEGMENT_LABEL_RE.test(segment.text) || SEGMENT_HASH_LABEL_RE.test(segment.text);
}

function labelTextOf(segment: Segment): string {
  const m = segment.text.match(SEGMENT_LABEL_RE);
  if (m) return normalize(m[1]);
  if (SEGMENT_HASH_LABEL_RE.test(segment.text)) return normalize(segment.text.replace(/#\s*$/, ""));
  return "";
}

/**
 * Rebuild visual segments from positioned items: bin into rows by Y
 * (tolerance matches the watcher), sort each row left→right, and split
 * on column-sized horizontal gaps. A segment is one visual cell — a
 * label, a value, or an inline "label: value" pair.
 */
export function segmentsFromLayout(layout: OrderSheetLayout): Segment[] {
  const segments: Segment[] = [];

  layout.forEach((page, pageIndex) => {
    const items = (page || []).filter((item) => typeof item?.str === "string" && item.str.trim());
    const sorted = [...items].sort((a, b) => b.y - a.y);

    const rows: Array<{ y: number; items: OrderSheetLayoutItem[] }> = [];
    for (const item of sorted) {
      let row: { y: number; items: OrderSheetLayoutItem[] } | null = null;
      let bestDelta = Infinity;
      for (const candidate of rows) {
        const delta = Math.abs(candidate.y - item.y);
        if (delta <= Y_TOLERANCE_PX && delta < bestDelta) {
          bestDelta = delta;
          row = candidate;
        }
      }
      if (row) row.items.push(item);
      else rows.push({ y: item.y, items: [item] });
    }

    rows.forEach((row, rowIndex) => {
      const inRow = row.items.sort((a, b) => a.x - b.x);
      let current: { pieces: string[]; x0: number; x1: number } | null = null;
      const flush = () => {
        if (!current) return;
        const text = current.pieces.join(" ").replace(/\s+/g, " ").trim();
        if (text) {
          segments.push({ text, x0: current.x0, x1: current.x1, y: row.y, page: pageIndex, rowIndex });
        }
        current = null;
      };
      for (const item of inRow) {
        const itemEnd = item.x + (item.w || 0);
        if (current) {
          const gap = item.x - current.x1;
          const fontSize = item.fs || 10;
          if (gap > fontSize * COLUMN_GAP_FACTOR) flush();
        }
        if (current) {
          current.pieces.push(item.str);
          current.x1 = Math.max(current.x1, itemEnd);
        } else {
          current = { pieces: [item.str], x0: item.x, x1: itemEnd };
        }
      }
      flush();
    });
  });

  return segments;
}

function collectLabelPhrases(segments: Segment[]): string[] {
  const labels = new Set<string>();
  for (const segment of segments) {
    const whole = labelTextOf(segment);
    if (whole) {
      labels.add(whole);
      continue;
    }
    const inline = segment.text.match(INLINE_PAIR_RE);
    if (inline) labels.add(normalize(inline[1]));
  }
  return [...labels].sort();
}

// Two independently-seeded FNV-1a 32-bit passes, concatenated to 16 hex
// chars. Deliberately NOT a crypto hash: this file is shared with browser
// bundles, where importing node:crypto would break the build, and a
// form-template signature only needs collision resistance over the few
// distinct forms an office prints.
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function fnv1a64(input: string): string {
  const a = fnv1a32(input, 0x811c9dc5);
  const b = fnv1a32(input, 0x811c9dc5 ^ 0x5bd1e995);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * Signature of the form's static label set. Values change per sheet;
 * the printed labels don't — so sheets from the same EHR template hash
 * identically. Returns "" when the page has too few labels to be a
 * recognizable form (e.g. a free-text letter), in which case nothing is
 * learned or applied.
 */
export function computeOrderSheetFingerprint(layout: OrderSheetLayout): string {
  const labels = collectLabelPhrases(segmentsFromLayout(layout));
  if (labels.length < 4) return "";
  return `${labels.length}-${fnv1a64(labels.join("|"))}`;
}

/** The values staff submitted from the review dialog, in job-field shape. */
export interface OrderSheetCorrection {
  patientFirstName?: string;
  patientLastName?: string;
  trayNumber?: string;
  phone?: string;
  jobTypeId?: string;
  destinationId?: string;
  /** ISO yyyy-mm-dd. */
  orderDate?: string;
}

/**
 * Which learnable fields the staff actually CHANGED relative to the
 * parser's original extraction. Used both to know what to learn and —
 * critically — to detect when a previously-learned rule produced a wrong
 * value the user just fixed (so a stale rule can be dropped instead of
 * left mis-filling every future sheet of that form).
 */
export function changedLearnableFields(
  original: ParsedOrderSheetFields | null,
  corrected: OrderSheetCorrection,
): OrderSheetLearnableField[] {
  const o = original || ({} as ParsedOrderSheetFields);
  const out: OrderSheetLearnableField[] = [];

  const first = (corrected.patientFirstName || "").trim();
  const last = (corrected.patientLastName || "").trim();
  if (
    first &&
    last &&
    (normalize(first) !== normalize(o.patientFirstName || "") ||
      normalize(last) !== normalize(o.patientLastName || ""))
  ) {
    out.push("patientName");
  }

  const tray = (corrected.trayNumber || "").trim();
  if (tray && tray !== (o.trayNumber || "")) out.push("trayNumber");

  const phone = phoneDigits(corrected.phone || "");
  if (phone && phone !== (o.phone || "")) out.push("phone");

  const orderDate = (corrected.orderDate || "").trim();
  if (orderDate && orderDate !== (o.orderDate || "")) out.push("orderDate");

  const jobTypeId = (corrected.jobTypeId || "").trim();
  if (jobTypeId && jobTypeId !== (o.jobTypeId || "")) out.push("jobType");

  const destinationId = (corrected.destinationId || "").trim();
  if (destinationId && destinationId !== (o.destinationId || "")) out.push("destination");

  return out;
}

function findValueSegment(segments: Segment[], matches: (seg: Segment, inlineValue: string | null) => boolean): {
  segment: Segment;
  inlineLabel: string | null;
} | null {
  for (const segment of segments) {
    const inline = segment.text.match(INLINE_PAIR_RE);
    if (inline && matches(segment, inline[2])) {
      return { segment, inlineLabel: normalize(inline[1]) };
    }
    if (!inline && !isLabelSegment(segment) && matches(segment, null)) {
      return { segment, inlineLabel: null };
    }
  }
  return null;
}

function anchorFor(segments: Segment[], target: Segment): { label: string; position: "right" | "below" } | null {
  // Nearest label to the LEFT on the same visual row.
  let best: Segment | null = null;
  for (const candidate of segments) {
    if (candidate.page !== target.page || candidate.rowIndex !== target.rowIndex) continue;
    if (candidate.x1 > target.x0 + 1) continue;
    if (!isLabelSegment(candidate)) continue;
    if (!best || candidate.x1 > best.x1) best = candidate;
  }
  if (best) return { label: labelTextOf(best), position: "right" };

  // Column-header form: a label directly ABOVE the value (within a few
  // rows and horizontally overlapping).
  for (const candidate of segments) {
    if (candidate.page !== target.page) continue;
    if (candidate.rowIndex >= target.rowIndex || target.rowIndex - candidate.rowIndex > 3) continue;
    if (candidate.y - target.y > 60) continue;
    if (!isLabelSegment(candidate)) continue;
    const overlaps = candidate.x0 < target.x1 && target.x0 < candidate.x1;
    if (overlaps) return { label: labelTextOf(candidate), position: "below" };
  }
  return null;
}

/**
 * Diff a user's review-dialog submission against what the parser
 * originally extracted, and derive anchor rules for the fields they
 * fixed. A rule is only produced when the corrected value can actually
 * be located on the sheet next to a printed label — values the user
 * typed from memory (not on the sheet) teach nothing, by design.
 *
 * `options` lets us also learn ANCHORS for lab / job-type when the
 * corrected id maps back to a label that appears on this sheet. Without
 * it, those fields can only learn raw-text → id mappings (valueMap),
 * which leaves the "parser found nothing" case unfixable.
 */
export function deriveOrderSheetAnchorRules(
  layout: OrderSheetLayout,
  original: ParsedOrderSheetFields | null,
  corrected: OrderSheetCorrection,
  options?: { jobTypes: OrderSheetOption[]; destinations: OrderSheetOption[] },
): OrderSheetAnchorRule[] {
  const segments = segmentsFromLayout(layout);
  const rules: OrderSheetAnchorRule[] = [];

  const addAnchored = (
    field: OrderSheetLearnableField,
    matches: (seg: Segment, inlineValue: string | null) => boolean,
  ) => {
    const found = findValueSegment(segments, matches);
    if (!found) return;
    if (found.inlineLabel) {
      rules.push({ field, label: found.inlineLabel, position: "right" });
      return;
    }
    const anchor = anchorFor(segments, found.segment);
    if (anchor && anchor.label) rules.push({ field, ...anchor });
  };

  // Patient name — match "First Last" or "Last, First" renderings.
  const first = (corrected.patientFirstName || "").trim();
  const last = (corrected.patientLastName || "").trim();
  if (
    first &&
    last &&
    (normalize(first) !== normalize(original?.patientFirstName || "") ||
      normalize(last) !== normalize(original?.patientLastName || ""))
  ) {
    const wanted = new Set([normalize(`${first} ${last}`), normalize(`${last} ${first}`)]);
    addAnchored("patientName", (seg, inlineValue) => {
      const candidate = normalize(inlineValue ?? seg.text);
      // Allow a middle initial / suffix between the tokens, nothing more.
      if (wanted.has(candidate)) return true;
      const tokens = candidate.split(" ");
      return tokens.length === 3 && wanted.has(`${tokens[0]} ${tokens[2]}`) && tokens[1].length <= 2;
    });
  }

  const tray = (corrected.trayNumber || "").trim();
  if (tray && tray !== (original?.trayNumber || "")) {
    addAnchored("trayNumber", (seg, inlineValue) => normalize(inlineValue ?? seg.text) === normalize(tray));
  }

  const phone = phoneDigits(corrected.phone || "");
  if (phone && phone !== (original?.phone || "")) {
    addAnchored("phone", (seg, inlineValue) => phoneDigits(inlineValue ?? seg.text) === phone);
  }

  const orderDate = (corrected.orderDate || "").trim();
  if (orderDate && orderDate !== (original?.orderDate || "")) {
    addAnchored("orderDate", (seg, inlineValue) => parseSheetDate((inlineValue ?? seg.text).trim()) === orderDate);
  }

  // Option fields (job type / lab) have TWO learning paths, used together:
  //
  //   • valueMap — the heuristics found raw text but couldn't map it to an
  //     office option. The correction teaches what that raw text means.
  //   • anchor — if the option's label can be located on the sheet, learn
  //     where it lives (label + position) so the next sheet doesn't need
  //     the parser to have found anything. This is the fix for "parser
  //     keeps missing the lab field" — without it, the user can review
  //     forever and the parser never improves.
  //
  // Both fire when applicable. Storage merges valueMaps across reviews
  // AND appends anchors to a per-field list, so each new correction adds
  // a search location instead of overwriting the last one.
  const findOptionAnchor = (field: "jobType" | "destination", correctedId: string, list: OrderSheetOption[]) => {
    if (!options) return;
    const option = list.find((o) => o.id === correctedId);
    if (!option?.label) return;
    addAnchored(field, (seg, inlineValue) => {
      const text = inlineValue ?? seg.text;
      if (!text) return false;
      return matchOption(text, [option]) === option.id;
    });
  };

  const jobTypeId = (corrected.jobTypeId || "").trim();
  if (jobTypeId && jobTypeId !== (original?.jobTypeId || "")) {
    if (original?.jobTypeText) {
      const key = normalize(original.jobTypeText);
      if (key) rules.push({ field: "jobType", label: "", position: "right", valueMap: { [key]: jobTypeId } });
    }
    findOptionAnchor("jobType", jobTypeId, options?.jobTypes || []);
  }
  const destinationId = (corrected.destinationId || "").trim();
  if (destinationId && destinationId !== (original?.destinationId || "")) {
    if (original?.destinationText) {
      const key = normalize(original.destinationText);
      if (key) rules.push({ field: "destination", label: "", position: "right", valueMap: { [key]: destinationId } });
    }
    findOptionAnchor("destination", destinationId, options?.destinations || []);
  }

  return rules;
}

export interface ApplyAnchorRulesResult {
  /** Only fields a rule successfully (and validly) extracted. */
  fields: Partial<ParsedOrderSheetFields>;
  /** Learnable-field keys that contributed, for the "used your saved fixes" UI. */
  applied: OrderSheetLearnableField[];
}

function extractAtAnchor(segments: Segment[], rule: OrderSheetAnchorRule): string {
  for (const segment of segments) {
    const inline = segment.text.match(INLINE_PAIR_RE);
    if (inline && normalize(inline[1]) === rule.label) return inline[2].trim();

    if (labelTextOf(segment) !== rule.label) continue;

    if (rule.position === "right") {
      // Everything to the right on the same row, until the next label.
      const after = segments
        .filter((s) => s.page === segment.page && s.rowIndex === segment.rowIndex && s.x0 >= segment.x1 - 1)
        .sort((a, b) => a.x0 - b.x0);
      const pieces: string[] = [];
      for (const part of after) {
        if (isLabelSegment(part) || INLINE_PAIR_RE.test(part.text)) break;
        pieces.push(part.text);
      }
      const value = pieces.join(" ").trim();
      if (value) return value;
    } else {
      // Nearest row below with horizontal overlap.
      const below = segments
        .filter(
          (s) =>
            s.page === segment.page &&
            s.rowIndex > segment.rowIndex &&
            s.rowIndex - segment.rowIndex <= 3 &&
            s.x0 < segment.x1 &&
            segment.x0 < s.x1 &&
            !isLabelSegment(s),
        )
        .sort((a, b) => a.rowIndex - b.rowIndex);
      if (below.length > 0) return below[0].text.trim();
    }
  }
  return "";
}

/**
 * Apply an office's learned rules for this form to a fresh sheet.
 * Every extracted value is re-validated through the same normalizers the
 * heuristic parser uses; anything that doesn't validate is dropped
 * rather than guessed.
 */
export function applyOrderSheetAnchorRules(
  layout: OrderSheetLayout,
  rules: OrderSheetAnchorRule[],
  options: { jobTypes: OrderSheetOption[]; destinations: OrderSheetOption[] },
): ApplyAnchorRulesResult {
  const segments = segmentsFromLayout(layout);
  const fields: Partial<ParsedOrderSheetFields> = {};
  const applied: OrderSheetLearnableField[] = [];

  const optionIdExists = (id: string, list: OrderSheetOption[]) => list.some((option) => option.id === id);

  for (const rule of rules) {
    const anchors = anchorsForApply(rule);

    if (rule.field === "jobType" || rule.field === "destination") {
      const list = rule.field === "jobType" ? options.jobTypes : options.destinations;
      let matchedId = "";
      let matchedText = "";

      // Try each LEARNED LOCATION first (label + position anchors). At
      // each one, extract the raw text and run it through the same
      // option matcher the heuristics use — this handles the
      // "parser previously found nothing" case that pure valueMaps
      // can't fix.
      for (const anchor of anchors) {
        const raw = extractAtAnchor(segments, {
          field: rule.field,
          label: anchor.label,
          position: anchor.position,
        });
        if (!raw) continue;
        const id = matchOption(raw, list);
        if (id && optionIdExists(id, list)) {
          matchedId = id;
          matchedText = raw;
          break;
        }
      }

      // Fall back to learned valueMap (raw text → office option id) —
      // covers the "parser found something but couldn't map it" case.
      if (!matchedId) {
        const map = rule.valueMap || {};
        for (const segment of segments) {
          const norm = normalize(segment.text);
          if (!norm) continue;
          for (const [key, id] of Object.entries(map)) {
            // The learned raw text must appear in the segment (or vice
            // versa for shorthand like "B+L" vs "B+L Ultra").
            if ((norm.includes(key) || key.includes(norm)) && optionIdExists(id, list)) {
              matchedId = id;
              matchedText = segment.text;
              break;
            }
          }
          if (matchedId) break;
        }
      }

      if (matchedId) {
        if (rule.field === "jobType") {
          fields.jobTypeId = matchedId;
          fields.jobTypeText = matchedText;
        } else {
          fields.destinationId = matchedId;
          fields.destinationText = matchedText;
        }
        applied.push(rule.field);
      }
      continue;
    }

    // Geometric fields: try every learned anchor; first one that
    // extracts a valid value wins. A previously-good anchor that's
    // empty on this sheet (different EHR template variant) falls
    // through to the next anchor the office has taught Otto.
    for (const anchor of anchors) {
      const raw = extractAtAnchor(segments, {
        field: rule.field,
        label: anchor.label,
        position: anchor.position,
      });
      if (!raw) continue;

      let validated = false;
      if (rule.field === "patientName") {
        const { first, last } = splitPatientName(raw);
        if (first && last && !/\d/.test(`${first}${last}`)) {
          fields.patientFirstName = first;
          fields.patientLastName = last;
          validated = true;
        }
      } else if (rule.field === "orderDate") {
        const iso = parseSheetDate(raw);
        if (iso) {
          fields.orderDate = iso;
          validated = true;
        }
      } else if (rule.field === "phone") {
        const digits = phoneDigits(raw);
        if (digits) {
          fields.phone = digits;
          validated = true;
        }
      } else if (rule.field === "trayNumber") {
        const tray = raw.match(/^[\w-]+/)?.[0] || "";
        if (tray) {
          fields.trayNumber = tray;
          validated = true;
        }
      }
      if (validated) {
        applied.push(rule.field);
        break;
      }
    }
  }

  return { fields, applied };
}

/**
 * Merge learned values over heuristic ones. Learned wins: the office
 * explicitly taught these locations, which beats vocabulary guessing.
 */
export function mergeLearnedFields(
  base: ParsedOrderSheetFields,
  learned: Partial<ParsedOrderSheetFields>,
): ParsedOrderSheetFields {
  const merged = { ...base };
  for (const [key, value] of Object.entries(learned)) {
    if (typeof value === "string" && value) (merged as Record<string, string>)[key] = value;
  }
  return merged;
}
