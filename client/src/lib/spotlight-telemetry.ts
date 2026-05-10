// Thin wrapper around POST /api/track for the spotlight system.
// Fire-and-forget — telemetry failures must never break the UI.

export type SpotlightTelemetryEvent =
  | "spotlight_modal_seen"
  | "spotlight_modal_dismissed"
  | "spotlight_modal_show_me"
  | "spotlight_tour_started"
  | "spotlight_tour_step_seen"
  | "spotlight_tour_completed"
  | "spotlight_tour_skipped"
  | "spotlight_pulse_dismissed"
  | "spotlight_target_clicked"
  | "spotlight_archive_opened"
  | "spotlight_archive_replay";

export function trackSpotlightEvent(
  eventType: SpotlightTelemetryEvent,
  metadata?: Record<string, any>,
) {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ eventType, metadata: metadata ?? {} }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}
