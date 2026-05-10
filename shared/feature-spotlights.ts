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
  /** Coachmark sequence triggered by the modal's primary CTA OR by
   *  hover/click on a pulse dot. */
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
    pulseUntilClicked: true,
    skipFirstSession: true,
    modal: {
      title: "Share order status with patients",
      body:
        "Generate a public link from any job. Patients see live order updates without logging in, without seeing PHI, and without knowing which office they came from. Customize what they see in Settings → Tracking Links.",
      primaryCtaLabel: "Show me",
      secondaryCtaLabel: "Maybe later",
    },
    steps: [
      {
        id: "tab",
        target: { kind: "testid", testId: "tab-job-details-tracking" },
        title: "New tab: Patient tracking",
        body: "Open any job and use this tab to generate, view, or edit a tracking link.",
        placement: "bottom",
      },
      {
        id: "save-and-track",
        target: { kind: "testid", testId: "button-save-job-and-track" },
        title: "Generate while you create",
        body: "On New Job, save the job and generate a tracking link in one click.",
        placement: "top",
        waitFor: { kind: "testid", testId: "dialog-job" },
      },
      {
        id: "settings-tab",
        target: { kind: "testid", testId: "tab-tracking-links" },
        title: "Set defaults once",
        body: "Open Settings → Tracking Links to choose which statuses patients see by default and customize the message you copy when sharing.",
        placement: "right",
        waitFor: { kind: "testid", testId: "tab-tracking-links" },
      },
    ],
  },
];

export function getSpotlightById(id: string): FeatureSpotlight | undefined {
  return FEATURE_SPOTLIGHTS.find((f) => f.id === id);
}

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
