// Feature spotlight registry — the source of truth for which in-app
// product tours / coachmarks are active. Edit this file when shipping
// a new feature worth highlighting.
//
// Lifecycle for an entry:
//   1. Add the entry with `releasedAt: <today>`.
//   2. Server-side `feature-flags.ts` (otto-web) must also list the id
//      under ENABLED_FEATURES (or it won't surface to the desktop).
//      The two-place check is intentional — code defines what's
//      possible; the portal kill-switch decides what's currently on.
//   3. After the rollout window, set `expiresAt` so the orchestrator
//      stops showing it to anyone who never opened the app during the
//      window. Don't delete the entry — old user-preferences records
//      reference the id.
//
// IDs MUST be globally unique and immutable. Never reuse an id even
// after retiring an entry, or stale user-preferences will resurrect.
//
// Keep the desktop bundle the source of asset truth: media paths
// resolve relative to `/spotlights/` in `client/public/spotlights/`.

export type SpotlightTarget =
  | { kind: "testid"; testId: string }
  | { kind: "ref"; refName: string };

export interface SpotlightStep {
  /** Stable id within a feature for analytics + resume. */
  id: string;
  /** Element to anchor to. Must be present in the DOM (or appear via
   *  `waitFor`) before the coachmark renders. */
  target: SpotlightTarget;
  /** Short bold heading (~5–8 words). */
  title: string;
  /** One- or two-sentence body. */
  body: string;
  /** Preferred bubble side — Popper flips automatically when needed. */
  placement?: "top" | "bottom" | "left" | "right";
  /** Wait until this element is also in the DOM before firing. Lets
   *  steps fire only when their host modal/panel is open. */
  waitFor?: SpotlightTarget;
  /** Optional CTA the orchestrator passes through to the coachmark. */
  cta?: { label: string; href?: string };
}

export interface SpotlightModal {
  /** Display title in the What's New modal. */
  title: string;
  /** One paragraph in plain prose (no markdown rendering in v1). */
  body: string;
  /** Optional bundled asset shown above the body. */
  media?: { kind: "image"; src: string; alt?: string };
  /** Primary CTA label — defaults to "Show me". */
  primaryCtaLabel?: string;
  /** Secondary dismiss label — defaults to "Maybe later". */
  secondaryCtaLabel?: string;
}

/**
 * What happens when the user clicks the modal's primary CTA.
 *
 *  - `tour` (default): runs the spotlight's `steps[]` as coachmarks.
 *  - `open-settings`: opens the office Settings modal pre-selected to
 *    a tab id. Useful when the feature lives entirely inside Settings
 *    (e.g. configuration-only features).
 *  - `none`: just dismiss the modal — no follow-up action. Use when
 *    the modal copy alone is the whole pitch.
 *
 * Default is `tour` for back-compat, but new entries should be
 * explicit so future-readers know what to expect.
 */
export type SpotlightShowMeAction =
  | { kind: "tour" }
  | { kind: "open-settings"; tab: string }
  | { kind: "none" };

export interface FeatureSpotlight {
  /** Stable, unique, never-reused. e.g. "patient-tracking-2026-05". */
  id: string;
  /** Human-readable name for the What's New archive ("Patient tracking"). */
  name: string;
  /** Yes/no banner copy used in the archive list. */
  shortDescription: string;
  /** ISO date the feature shipped. Used by the migration filter (existing
   *  users only see features released after their first post-deploy login). */
  releasedAt: string;
  /** ISO date after which the spotlight stops surfacing. Optional. */
  expiresAt?: string;
  /** Optional What's New modal. Omit when the feature only deserves
   *  pulse + coachmarks (no announcement). */
  modal?: SpotlightModal;
  /** What the modal's primary CTA does. Defaults to running the tour
   *  (i.e. rendering `steps[]` as coachmarks). When set to
   *  `open-settings`, `steps` is ignored on the show-me path. */
  onShowMe?: SpotlightShowMeAction;
  /** Coachmark sequence triggered by `onShowMe.kind === "tour"` OR by
   *  hover/click on a pulse dot. May be empty if the feature uses
   *  `open-settings` / `none` as its show-me action and has
   *  `pulseUntilClicked: false`. */
  steps: SpotlightStep[];
  /** Stop showing pulses after this many sessions, even if not clicked.
   *  Default 5. Set to 0 to never auto-archive. */
  dismissAfterLogins?: number;
  /** Render persistent pulse dots over each step's target until the user
   *  clicks the target naturally OR dismisses the dot. Default true. */
  pulseUntilClicked?: boolean;
  /** Don't fire on a brand-new user's first session — lets onboarding
   *  finish before spotlights start. Default true. */
  skipFirstSession?: boolean;
}

// ── Active registry ──────────────────────────────────────────────────

export const FEATURE_SPOTLIGHTS: FeatureSpotlight[] = [
  {
    // releasedAt bumped past current users' migrationDeadlines so this
    // surfaces to *everyone* on next login — not only accounts created
    // after this deploy. Picked a date a few days out from the deploy
    // so even a slow rollout still falls before this date for existing
    // users (their migrationDeadline is "first session after the
    // spotlight system shipped").
    id: "patient-tracking-2026-05",
    name: "Patient tracking",
    shortDescription: "Share order status with patients via a public link — no PHI, no office identity.",
    releasedAt: "2026-05-15",
    dismissAfterLogins: 3,
    // Modal-only experience for now: the multi-step coachmark tour was
    // brittle (timing/positioning bugs around dialog mounts and
    // off-screen tabs), so the announcement is the modal copy and the
    // primary CTA jumps straight into the configuration surface. No
    // pulse dots either — same fragility. We can re-enable the tour
    // once the orchestrator's target-resolution edge cases are
    // ironed out.
    pulseUntilClicked: false,
    skipFirstSession: true,
    modal: {
      title: "Share order status with patients",
      body:
        "Otto can auto-generate a public tracking link for every new job — patients see live order updates without logging in, without seeing PHI, and without knowing which office they came from. Turn auto-generate on in Settings → Tracking Links, then customize what patients see.",
      primaryCtaLabel: "Open Tracking Links settings",
      secondaryCtaLabel: "Maybe later",
    },
    onShowMe: { kind: "open-settings", tab: "tracking" },
    // No steps — the show-me action is `open-settings`, not `tour`.
    steps: [],
  },
];

// ── Per-feature user state shape (stored in user.preferences) ────────
//
// preferences.featureSpotlights = {
//   __meta__: { migrationDeadline: ISO },   // see preferences-migration below
//   __sessions__: { count: number, lastSessionId: string },
//   [featureId]: { ... }
// }

export interface SpotlightUserState {
  firstSeenAt?: string;
  loginsSeenIn?: number;
  modalDismissedAt?: string;
  modalShowMeClickedAt?: string;
  tourCompletedAt?: string;
  tourSkippedAt?: string;
  pulseDismissedAt?: string;
  targetClickedAt?: string;
  // Per-step click telemetry (so we can re-show only un-clicked pulses).
  stepsClicked?: Record<string, string>; // stepId -> ISO
}

export interface SpotlightPreferencesShape {
  __meta__?: { migrationDeadline?: string };
  __sessions__?: { count?: number; lastSessionId?: string };
  [featureId: string]: any;
}

/** Newly-seeded shape for first-time users of the spotlight system. The
 *  migrationDeadline is set to "now" on first login post-deploy so we
 *  don't dump every active spotlight on existing users. */
export function freshSpotlightPrefs(now = new Date()): SpotlightPreferencesShape {
  return {
    __meta__: { migrationDeadline: now.toISOString() },
    __sessions__: { count: 0 },
  };
}

/** Decide whether `feature` is eligible for `state`. Doesn't account for
 *  server-side enable-flag (callers AND it). */
export function isFeatureEligible(
  feature: FeatureSpotlight,
  prefs: SpotlightPreferencesShape | undefined,
  now: Date = new Date(),
): boolean {
  if (feature.expiresAt && new Date(feature.expiresAt) < now) return false;

  const cutoff = prefs?.__meta__?.migrationDeadline;
  if (cutoff && new Date(feature.releasedAt) < new Date(cutoff)) return false;

  const state = (prefs?.[feature.id] as SpotlightUserState | undefined) ?? {};
  const dismissAfter = feature.dismissAfterLogins ?? 5;
  if (dismissAfter > 0 && (state.loginsSeenIn ?? 0) >= dismissAfter) return false;

  // Considered "done" if either the modal was dismissed AND the pulse
  // was dismissed/clicked, OR the tour completed/skipped, OR the target
  // was clicked naturally.
  const tourClosed = !!(state.tourCompletedAt || state.tourSkippedAt);
  const pulseClosed = !!(state.pulseDismissedAt || state.targetClickedAt);
  const modalClosed = !!(state.modalDismissedAt || state.modalShowMeClickedAt);
  if (tourClosed && pulseClosed) return false;
  if (!feature.modal && pulseClosed) return false;
  if (feature.modal && modalClosed && pulseClosed) return false;

  return true;
}
