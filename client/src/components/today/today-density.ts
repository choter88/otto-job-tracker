// M9 (req 9): a single density scale shared by every Today tile
// (job-queue-tile, starred-tile, activity-tile) so rows read as one
// consistent, tighter rhythm instead of ad-hoc per-file spacing. Row chrome
// (vertical padding, inter-line gaps) shrinks here; interactive controls
// (buttons) are left at their existing tap-target size — density trims
// whitespace, not affordances.
export const TODAY_DENSITY = {
  // Group/section header bar (tile <header>, chase-group holder header).
  header: "px-4 py-1.5",
  // A single data row (OutreachRow, ChaseRow, Remember row, activity row).
  row: "px-4 py-1.5",
  // Gap between a row's title line and the line under it
  // (status/summary/note). Was mt-1 / mt-0.5 in various spots pre-M9.
  lineGap: "mt-0.5",
  // Gap between two stacked secondary lines (e.g. status line -> attempt
  // summary line, or note line stacked under status).
  lineGapTight: "mt-px",
} as const;
