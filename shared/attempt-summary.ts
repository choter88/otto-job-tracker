import { format } from "date-fns";

// Today Dashboard v2 (M4): pure formatter for the per-row attempt-history
// summary line, e.g. "3 attempts · last text · MK · Jul 3". Separator is
// " · " (space-middot-space) throughout; never an em-dash, to keep the
// present-tense, plain-language tone used across the Today dashboard copy.
export type AttemptSummary = {
  count: number;
  lastType: "called" | "texted";
  lastActorInitials: string | null;
  lastAt: number;
};

export function formatAttemptSummary(s: AttemptSummary): string {
  const countLabel = s.count === 1 ? "1 attempt" : `${s.count} attempts`;
  const lastLabel = s.lastType === "texted" ? "last text" : "last call";
  const parts = [countLabel, lastLabel];
  if (s.lastActorInitials) {
    parts.push(s.lastActorInitials);
  }
  parts.push(format(s.lastAt, "MMM d"));
  return parts.join(" · ");
}
