// Marker prefix on a job comment that was generated when an office user
// added/updated a "Note for patient" on the tracking link. The Comments
// panel strips the marker and renders these comments distinctly so staff
// can see what the patient currently sees and when it was set. Lives in
// its own file (not job-details-modal.tsx) to avoid a circular import
// between the modal and the comments panel that the modal mounts.

export const TRACKER_NOTE_COMMENT_PREFIX = "[tracker-note]\n";

export function isTrackerNoteComment(content: string | null | undefined): boolean {
  return typeof content === "string" && content.startsWith(TRACKER_NOTE_COMMENT_PREFIX);
}

export function stripTrackerNotePrefix(content: string): string {
  return content.startsWith(TRACKER_NOTE_COMMENT_PREFIX)
    ? content.slice(TRACKER_NOTE_COMMENT_PREFIX.length)
    : content;
}
