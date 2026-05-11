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
