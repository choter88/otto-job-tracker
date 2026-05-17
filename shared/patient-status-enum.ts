// Mirror of the portal's canonical patient-facing status enum. The
// desktop translates its internal status model (office-custom ids,
// labels, colors, order) into one of these values before emitting an
// event to the portal. Anything we can't map gets dropped here rather
// than smuggled through to the portal as free text.
//
// Keep in sync by hand with otto-web/server/portal/tracking-status-map.ts.
// The list is short and changes rarely.

export type PatientStatus =
  | "received"
  | "sent_to_lab"
  | "in_progress"
  | "quality_check"
  | "ready_for_pickup"
  | "completed"
  | "delayed"
  | "cancelled";

export const PATIENT_STATUS_VALUES: readonly PatientStatus[] = [
  "received",
  "sent_to_lab",
  "in_progress",
  "quality_check",
  "ready_for_pickup",
  "completed",
  "delayed",
  "cancelled",
] as const;

// Maps every standard Otto status id (and a few common variants) onto
// the canonical enum. Office-custom status ids are not present here —
// the desktop's mapStatusToEnum() handles them via the office's
// patientStatusLabels override, then falls back to this map.
const STANDARD_ID_TO_ENUM: Record<string, PatientStatus> = {
  job_created: "received",
  received: "received",
  ordered: "sent_to_lab",
  sent_to_lab: "sent_to_lab",
  in_progress: "in_progress",
  in_production: "in_progress",
  quality_check: "quality_check",
  ready_for_pickup: "ready_for_pickup",
  ready: "ready_for_pickup",
  completed: "completed",
  picked_up: "completed",
  delivered: "completed",
  delayed: "delayed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

/**
 * Map a desktop status id (standard OR office-custom) to a canonical
 * portal enum value. Returns null when no mapping exists — caller MUST
 * drop the event (do not send to portal) rather than substitute a
 * placeholder.
 *
 * Priority:
 *   1. Office's explicit per-status enum mapping (settings.trackingLinkDefaults.statusEnumMapping[id])
 *   2. Standard built-in mapping
 *   3. null — out of vocabulary
 */
export function mapStatusToEnum(
  statusId: string | undefined | null,
  officeMapping?: Record<string, string> | undefined,
): PatientStatus | null {
  if (typeof statusId !== "string" || statusId.length === 0) return null;
  const trimmed = statusId.trim().toLowerCase();

  if (officeMapping) {
    const override = officeMapping[statusId] ?? officeMapping[trimmed];
    if (typeof override === "string" && (PATIENT_STATUS_VALUES as readonly string[]).includes(override)) {
      return override as PatientStatus;
    }
  }

  return STANDARD_ID_TO_ENUM[trimmed] ?? null;
}

export function isPatientStatus(value: unknown): value is PatientStatus {
  return typeof value === "string" && (PATIENT_STATUS_VALUES as readonly string[]).includes(value);
}
