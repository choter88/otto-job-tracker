# Feature spotlights

In-app product-tour system for highlighting newly-shipped features.
Modal + pulse dot + coachmark coachmarks, anchored by `data-testid`,
state persisted per-user in `users.preferences.featureSpotlights`.

**The portal companion piece lives in `otto-web/docs/feature-spotlights.md`** —
read both if you're touching the system end-to-end.

---

## TL;DR — "I want to flag the new X feature for spotlight"

When you (the user) say this, do the following, in order:

1. **Make sure every UI element you'll point at has a `data-testid`.**
   The codebase already uses these heavily; if your new buttons/tabs
   don't have them, add them in the same edit.
2. **Add ONE entry to `FEATURE_SPOTLIGHTS`** in
   [`shared/feature-spotlights.ts`](../shared/feature-spotlights.ts).
   Pick a stable id, set `releasedAt`, write the modal copy + steps.
3. **That's it.** No portal change required unless you need to
   kill-switch it (see below). The desktop registry is the source of
   truth; the portal is opt-out only.
4. Type-check, build, ship the desktop. The portal needs no redeploy.

The rest of this doc is the reference for getting the entry right.

---

## How the system surfaces a spotlight

Per user, per session:

```
sign in
  ↓
session counter bumps  →  if session 1 and skipFirstSession (default true), skip
  ↓
for each entry in FEATURE_SPOTLIGHTS
  ↓
  is it eligible? (released after the user's migrationDeadline,
                   not past expiresAt, not already dismissed,
                   not on portal's DISABLED_FEATURES list)
  ↓ yes
  is the modal still un-dismissed?
    ↓ yes               ↓ no
    show WhatsNewModal  render pulse dots over each step's target
                        (until clicked or `dismissAfterLogins` sessions)
```

When the user clicks **Show me** in the modal: the orchestrator sets a
tour cursor and renders a `SpotlightCoachmark` for step 0. **Next**
advances; **Skip tour** ends it; **Done** on the last step completes it.

When the user clicks the actual targeted element (e.g. opens the new
tab themselves): it counts as engagement and dismisses the pulse for
that step automatically.

The user can replay any tour at any time from **User menu → What's new
→ Replay**.

---

## Anatomy of a registry entry

```ts
{
  // Stable, globally unique, IMMUTABLE. Convention: kebab-case-feature-name + YYYY-MM.
  // NEVER reuse an id, even after retiring an entry — old user-preferences
  // records reference it and would resurrect.
  id: "patient-tracking-2026-05",

  // Shown in the "What's new" archive list.
  name: "Patient tracking",
  shortDescription: "One-line value prop, no marketing speak.",

  // ISO date the feature shipped. Used by the migration filter:
  // existing users only see features released AFTER their first
  // post-spotlight-system login. So if you're shipping a feature
  // alongside the first deploy of this system, set this to a date
  // a few days in the future or only new users will see it.
  releasedAt: "2026-05-10",

  // Optional. Auto-archive after this date.
  expiresAt: "2026-08-10",

  // OPTIONAL — omit for low-key features that just need a pulse dot.
  modal: {
    title: "Big eye-catching headline",
    body: "One paragraph explaining the value, no marketing speak.",
    // Optional bundled image, otherwise a default 64px indigo Sparkles
    // tile renders. Put images in client/public/spotlights/.
    media: { kind: "image", src: "/spotlights/my-feature.png", alt: "..." },
    primaryCtaLabel: "Show me",     // default
    secondaryCtaLabel: "Maybe later", // default
  },

  // 1–4 coachmarks. More than 4 is too long; consider splitting.
  steps: [
    {
      id: "step-1",                              // unique within the feature
      target: { kind: "testid", testId: "your-button-testid" },
      title: "Step heading (~5–8 words)",
      body: "One or two sentences max.",
      placement: "bottom",                       // top | bottom | left | right
      // OPTIONAL: only render this step when the host element is in
      // the DOM. Useful when the target lives inside a dialog/panel
      // that's only open in certain workflows.
      waitFor: { kind: "testid", testId: "the-host-modal-testid" },
    },
  ],

  // Knobs (sane defaults shown).
  dismissAfterLogins: 3,    // hide after N sessions even if not clicked. default 5.
  pulseUntilClicked: true,  // persistent pulse dot. default true.
  skipFirstSession: true,   // hide on session 1 (post-onboarding). default true.
}
```

### Picking ids

- Format: `kebab-case-feature-name-YYYY-MM` — date is the *release* month.
- `patient-tracking-2026-05`, `bulk-status-update-2026-07`, etc.
- IDs are forever. If you redesign a feature, ship a new id; don't reuse.

### Picking targets

- **Default to `data-testid`.** It's stable, already used by tests, and
  the rest of the codebase uses the same selectors. Most clickable Otto
  elements already have one.
- For elements that don't have a useful testid (deeply virtualized
  lists, third-party widgets), use the ref escape hatch:
  ```ts
  // In the component:
  import { registerSpotlightRef } from "@/lib/spotlight-target";
  <button ref={(el) => registerSpotlightRef("my-thing", el)}>...</button>

  // In the registry:
  target: { kind: "ref", refName: "my-thing" }
  ```
- If a step's target lives inside a modal/panel, use `waitFor` so the
  coachmark doesn't fire against a 0×0 phantom. Set `waitFor` to a
  testid that exists ONLY when the host is open.

### Writing copy

- **Modal title**: 5–8 words, calls out the value.
- **Modal body**: one paragraph. Not marketing — explain *what* the
  feature does and *who* it's for.
- **Step title**: 3–6 words.
- **Step body**: one or two sentences max. The bubble is small.
- Avoid "you can now…" — the system itself signals "new". Just say
  what the thing does.

### Picking placement

The bubble auto-flips when it would clip the viewport. `placement` is
your *preferred* side. Rule of thumb:

- Tab in a tab strip: `placement: "bottom"`
- Button in a top toolbar: `placement: "bottom"`
- Item in a left sidebar: `placement: "right"`
- Footer button: `placement: "top"`

### Step count

Keep tours to 1–4 steps. Users skip after 4–5. If your feature has
more entry points worth highlighting, ship a follow-up spotlight a
few weeks later for the secondary surfaces.

---

## State, persistence, telemetry

**State** lives on `users.preferences.featureSpotlights` (existing
JSON column — no schema change). Per-user, server-authoritative.
Tracked per feature: `firstSeenAt`, `loginsSeenIn`, `modalDismissedAt`,
`modalShowMeClickedAt`, `tourCompletedAt`, `tourSkippedAt`,
`pulseDismissedAt`, `targetClickedAt`, `stepsClicked`.

`__meta__.migrationDeadline` is stamped on the first session a user
has after the spotlight system shipped. It filters out features
released before that timestamp — protects existing users from a
"new!" tsunami on day one.

**Telemetry** fires via `/api/track` for these event types (all in
`CLIENT_TRACKABLE_EVENTS` in `server/usage-tracker.ts`):

| Event | Fires when |
|---|---|
| `spotlight_modal_seen` | What's New modal first opened for a feature |
| `spotlight_modal_dismissed` | User clicked "Maybe later" or X |
| `spotlight_modal_show_me` | User clicked the primary CTA |
| `spotlight_tour_started` | Tour cursor activated |
| `spotlight_tour_step_seen` | User advanced past a step (carries `stepId`) |
| `spotlight_tour_completed` | Reached the last step |
| `spotlight_tour_skipped` | "Skip tour" clicked (carries `atStep`) |
| `spotlight_pulse_dismissed` | Pulse dot's X clicked |
| `spotlight_target_clicked` | Targeted element clicked naturally (engagement) |
| `spotlight_archive_opened` | User menu → What's new |
| `spotlight_archive_replay` | Replay button on an archive row |

Query by `metadata.featureId` to measure adoption / drop-off per
spotlight, per step.

---

## Code map

```
shared/feature-spotlights.ts                Registry + types + freshSpotlightPrefs
client/src/hooks/use-feature-spotlights.ts  State, mutators, derived `activeSpotlights`
client/src/lib/spotlight-target.ts          DOM resolution + bounding-rect tracking
client/src/lib/spotlight-telemetry.ts       Fire-and-forget POST /api/track wrapper
client/src/components/spotlight/
  ├── feature-spotlight-host.tsx            App-root mount + global event bus
  ├── feature-spotlight-orchestrator.tsx    Decides what to show
  ├── spotlight-pulse.tsx                   Persistent pulse dot
  ├── spotlight-coachmark.tsx               Tooltip bubble with arrow
  ├── whats-new-modal.tsx                   First-impression modal
  └── whats-new-archive.tsx                 User menu → What's new
server/license-client.ts                    portalGetFeatureFlags()
server/routes.ts                            GET /api/feature-flags proxy
```

---

## Kill-switch / disable a spotlight in the wild

If a spotlight is misbehaving in production:

1. Edit `otto-web/server/portal/feature-flags.ts` — add the spotlight's
   id to `DISABLED_FEATURES`.
2. Push otto-web → portal auto-deploys.
3. Within ~30 minutes (the desktop's React-Query staleTime), every
   running client stops surfacing the spotlight.

No desktop release needed. The local registry stays as-is.

---

## Common gotchas

- **Did your spotlight not appear?** First check: did the user
  actually pass session 2? Brand-new accounts skip session 1 by
  design. Second: was the feature `releasedAt` BEFORE the user's
  `migrationDeadline`? If yes, only users who first logged in before
  that release date will see it (i.e., nobody if it's a fresh deploy).
  To force a spotlight on existing users on the first deploy, set
  `releasedAt` to a future date.
- **Coachmark fires at viewport (0,0)?** The target's bounding rect
  is empty. The targeted element exists in the DOM but isn't visible
  (display:none, aria-hidden parent, off-screen). Add a `waitFor`
  pointing at the element that becomes visible only when the host
  panel is open.
- **Pulse dot in the wrong corner?** It defaults to top-right of the
  target. Pass `anchor` to the `<SpotlightPulse>` if you ever render
  one directly (the orchestrator currently always uses default).
- **Reused an id by mistake?** Existing user state under that id is
  carried over. Don't do this. Pick a new id.

---

## Don't do this

- ❌ Reuse a retired feature's id for a new spotlight.
- ❌ Ship a spotlight without a `data-testid` on the target. Silent
  no-op + 4-second auto-skip means QA might miss it.
- ❌ Write more than 4 steps. Users won't finish.
- ❌ Edit a live spotlight's `id` after release. Rename freely; never
  re-id.
- ❌ Reach into `users.preferences.featureSpotlights` directly. Use
  the `useFeatureSpotlights` hook's mutators.
