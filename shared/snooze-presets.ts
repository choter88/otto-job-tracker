// Pure preset -> timestamp helper for the "Snooze" action on Today Dashboard
// rows. All presets resolve to 08:00 local time on the target day, computed
// from `nowMs` (defaults to the real current time).
export type SnoozePreset = "tomorrow" | "friday" | "next_week";

export const SNOOZE_PRESET_LABELS: Record<SnoozePreset, string> = {
  tomorrow: "Tomorrow",
  friday: "This Friday",
  next_week: "Next week",
};

const EIGHT_AM = 8;
const FRIDAY = 5;
const MONDAY = 1;

function atEightAm(base: Date, dayOffset: number): number {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(EIGHT_AM, 0, 0, 0);
  return d.getTime();
}

/**
 * Returns epoch ms for the preset, normalized to 08:00 local on the target
 * day, computed from nowMs.
 *   tomorrow  -> next calendar day at 08:00 local
 *   friday    -> the coming Friday at 08:00 local (if today is Friday before
 *                08:00, today; else the next Friday)
 *   next_week -> Monday of next week at 08:00 local
 */
export function snoozeUntilMs(preset: SnoozePreset, nowMs: number = Date.now()): number {
  const now = new Date(nowMs);

  switch (preset) {
    case "tomorrow":
      return atEightAm(now, 1);

    case "friday": {
      const day = now.getDay();
      let offset = (FRIDAY - day + 7) % 7;
      if (offset === 0 && now.getHours() >= EIGHT_AM) {
        offset = 7;
      }
      return atEightAm(now, offset);
    }

    case "next_week": {
      const day = now.getDay();
      // Days until *this* week's Monday (0 if today is Monday), then add a
      // full week so the result always lands on next week's Monday.
      const daysSinceMonday = (day - MONDAY + 7) % 7;
      const offset = 7 - daysSinceMonday;
      return atEightAm(now, offset);
    }

    default: {
      const exhaustive: never = preset;
      throw new Error(`Unknown snooze preset: ${exhaustive}`);
    }
  }
}
