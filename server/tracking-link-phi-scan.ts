// PHI scan for the patient-facing note attached to a tracking link. Runs
// on the desktop because that's where the patient data lives — otto-web
// holds only the snapshot we send it, and the snapshot intentionally
// excludes patient identity.
//
// Conservative-by-default: high-signal regexes (phone, email, SSN, DOB)
// plus a check against the actual patient name(s) and phone number(s)
// on the linked jobs. Two narrow keywords (`prescription`, `diagnosis`)
// catch the most obvious clinical leaks; the dialog warning copy carries
// the rest of the load instead of an aggressive keyword list that would
// false-positive on everyday words.

import type { Job, ArchivedJob } from "@shared/schema";

const PHONE_RE = /(\+?\d[\d\-\.\s]{7,}\d)/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SSN_RE = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/;
const DOB_RE = /\b(0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12]\d|3[01])[\/\-\.](19|20)\d{2}\b/;
const RX_KEYWORDS = ["prescription", "diagnosis"];

export type PhiScanInput = {
  notes: string | null | undefined;
  jobs: Pick<Job | ArchivedJob, "patientFirstName" | "patientLastName" | "phone">[];
};

export type PhiScanResult =
  | { ok: true }
  | { ok: false; reason: string };

export function scanNotesForPhi(input: PhiScanInput): PhiScanResult {
  const raw = (input.notes ?? "").trim();
  if (raw.length === 0) return { ok: true };
  if (raw.length > 500) {
    return { ok: false, reason: "Notes must be 500 characters or fewer." };
  }

  const text = raw;
  const lower = ` ${text.toLowerCase()} `;

  if (PHONE_RE.test(text)) {
    return {
      ok: false,
      reason: "Notes appear to contain a phone number — patients shouldn't see contact info on the public page.",
    };
  }
  if (EMAIL_RE.test(text)) return { ok: false, reason: "Notes appear to contain an email address." };
  if (SSN_RE.test(text)) return { ok: false, reason: "Notes appear to contain a Social Security number." };
  if (DOB_RE.test(text)) return { ok: false, reason: "Notes appear to contain a date of birth." };
  for (const kw of RX_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        ok: false,
        reason: "Notes appear to contain medical or prescription details. Keep notes non-clinical.",
      };
    }
  }

  // Patient name + phone match against each linked job. Last name + first
  // name (>= 4 chars to avoid common-word false positives) + phone digits
  // are the high-signal checks.
  for (const j of input.jobs) {
    const last = (j.patientLastName ?? "").trim();
    if (last.length >= 2) {
      const re = new RegExp(`\\b${escapeRegex(last)}\\b`, "i");
      if (re.test(text)) {
        return { ok: false, reason: "Notes appear to contain a patient last name." };
      }
    }
    const first = (j.patientFirstName ?? "").trim();
    if (first.length >= 4) {
      const re = new RegExp(`\\b${escapeRegex(first)}\\b`, "i");
      if (re.test(text)) {
        return { ok: false, reason: "Notes appear to contain a patient first name." };
      }
    }
    const phone = (j.phone ?? "").replace(/\D/g, "");
    if (phone.length >= 7) {
      const digitText = text.replace(/\D/g, "");
      if (digitText.includes(phone.slice(-7))) {
        return { ok: false, reason: "Notes appear to contain a patient phone number." };
      }
    }
  }

  return { ok: true };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
