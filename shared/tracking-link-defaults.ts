/**
 * Shared tracking-link defaults — the office-wide knobs that govern what
 * patient tracking links look like by default.
 *
 * Lives in `shared/` (not client/) because both the desktop server (when
 * seeding new offices in `getDefaultOfficeSettings`) and the client UI
 * need the same defaults. The editor component in
 * `client/src/components/customization/tracking-link-defaults-editor.tsx`
 * re-exports these so existing client imports keep working unchanged.
 */

export interface TrackingLinkDefaults {
  /**
   * When true, every newly-created job automatically gets a tracking
   * link generated using the office's defaults. The user can opt out
   * per-job via a checkbox in the New Job dialog. New offices ship with
   * this set to `true` so the "simplify by default" promise holds —
   * existing offices keep whatever they had.
   */
  autoGenerateTrackingLinks?: boolean;
  visibleStatuses?: string[];
  defaultNotes?: string;
  // Office-wide template the staff copies from the share view and pastes
  // into Weave / SMS / email. Supports `{url}` (required) and `{eta}`
  // placeholders. PHI never goes through this template — it's the office's
  // own outbound voice, not the patient page itself.
  messageTemplate?: string;
  // Per-job-type overrides for visible statuses. Falls back to the global
  // `visibleStatuses` for any type not present here.
  byJobType?: Record<string, { visibleStatuses?: string[] }>;
  // Per-status patient-facing label overrides. When set, the patient
  // page renders the office's chosen label instead of Otto's static
  // default. Office responsible for keeping these generic / non-PHI;
  // length-capped to 60 chars at send time.
  patientStatusLabels?: Record<string, string>;
}

// `delayed` intentionally excluded — it surfaces as a banner on the patient
// page when active rather than as a sequential timeline step.
export const DEFAULT_VISIBLE_STATUSES = [
  "ordered",
  "in_progress",
  "ready_for_pickup",
];

export const DEFAULT_MESSAGE_TEMPLATE = "Hi! Here's a link to follow your order: {url}";

/**
 * Compute the union of visible statuses for a set of job types, given
 * the office's tracking-link defaults. Per-job-type overrides win when
 * present for the type; otherwise the global default applies. When
 * multiple job types are in scope (a link covers multiple jobs), the
 * union is taken so the patient sees every stage any job will go
 * through.
 *
 * Lives in `shared/` because the server (auto-gen) and the client
 * (Generate dialog, empty-state Generate button) both need to make
 * the same decision when constructing a new tracking link.
 */
export function computeDefaultVisibleStatuses(
  selectedJobTypes: string[],
  globalDefault: string[],
  byJobType: Record<string, { visibleStatuses?: string[] } | undefined> | undefined,
): string[] {
  if (selectedJobTypes.length === 0) return globalDefault;
  const typed = byJobType ?? {};
  const out = new Set<string>();
  const seen = new Set<string>();
  const uniqueTypes: string[] = [];
  for (const t of selectedJobTypes) {
    if (seen.has(t)) continue;
    seen.add(t);
    uniqueTypes.push(t);
  }
  for (const t of uniqueTypes) {
    const override = typed[t]?.visibleStatuses;
    const list = Array.isArray(override) && override.length > 0 ? override : globalDefault;
    for (const s of list) out.add(s);
  }
  return Array.from(out);
}

/**
 * Resolve the office's tracking-link defaults for the given job types.
 * Single source of truth for "what should a new tracking link look like
 * by default" — used by the server auto-gen path AND the client's
 * one-click empty-state Generate button so both surfaces produce the
 * same shape of link.
 *
 * - `visibleStatuses` honors per-job-type overrides via
 *   `computeDefaultVisibleStatuses`.
 * - `customNotes` falls back to null when the office's defaultNotes
 *   is empty/missing (preferring null over "" downstream).
 *
 * Tolerates malformed settings — defensively normalizes through
 * Array.isArray / typeof checks so a partially-set office row can't
 * crash auto-gen.
 */
export function resolveTrackingLinkDefaultsForJobTypes(
  settings: unknown,
  jobTypes: string[],
): { visibleStatuses: string[]; customNotes: string | null } {
  const tld = ((settings as any)?.trackingLinkDefaults ?? {}) as {
    visibleStatuses?: unknown;
    defaultNotes?: unknown;
    byJobType?: unknown;
  };
  const global =
    Array.isArray(tld.visibleStatuses) && tld.visibleStatuses.length > 0
      ? (tld.visibleStatuses as string[])
      : DEFAULT_VISIBLE_STATUSES;
  const byJobType =
    tld.byJobType && typeof tld.byJobType === "object" && !Array.isArray(tld.byJobType)
      ? (tld.byJobType as Record<string, { visibleStatuses?: string[] }>)
      : undefined;
  const visibleStatuses = computeDefaultVisibleStatuses(jobTypes, global, byJobType);
  const customNotes =
    typeof tld.defaultNotes === "string" && tld.defaultNotes.trim().length > 0
      ? tld.defaultNotes
      : null;
  return { visibleStatuses, customNotes };
}
