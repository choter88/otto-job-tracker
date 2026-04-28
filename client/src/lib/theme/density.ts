/**
 * Translate the user's font-size preference into a `data-ui-scale` attribute
 * on <html>, which the tokens.css density block reads to scale row heights,
 * padding, and the base UI font size.
 *
 * We intentionally do NOT add a separate density picker — font-size is the
 * one knob the user already has, and bumping it up should pull spacing
 * along with it so layouts breathe rather than just text growing. Each tier
 * maps 1:1 to the user's font-size pref, so any UI built on
 * `calc(Xpx * var(--ui-scale))` (table text, density-aware spacing) scales
 * smoothly across all five sizes — not just lg/xl.
 *
 * Source values come from user-settings-modal.tsx FONT_SIZE_OPTIONS:
 *   xs (12px) · sm (13px) · default (14px) · lg (16px) · xl (18px)
 */

export type UiScale = "xs" | "sm" | "default" | "lg" | "xl";

const FONT_SIZE_TO_SCALE: Record<string, UiScale> = {
  xs: "xs",
  sm: "sm",
  default: "default",
  lg: "lg",
  xl: "xl",
};

export function applyUiScale(fontSizePref: string | null | undefined): void {
  const key = String(fontSizePref || "default").toLowerCase().trim();
  const scale = FONT_SIZE_TO_SCALE[key] || "default";
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-ui-scale", scale);
  }
}
