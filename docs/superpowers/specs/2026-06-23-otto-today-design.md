# Otto Today — Design Spec

**Date:** 2026-06-23
**Status:** Approved (brainstorm), ready for implementation plan

## Goal

Replace/augment the dashboard with an **Otto Today** view: a per-user, role-seeded
landing page that surfaces the day's three actions — call patients whose jobs are
ready, chase the lab on jobs sitting too long, and review what happened while you
were away — plus a fixed "Remember" (starred) rail.

## Non-goals (explicit scope ceiling)

- **Not** a free-form dashboard builder. No drag-drop grid, no resizable tiles, no
  layout engine, no new charting dependency.
- Only the **two left-column slots** are configurable. The right rail is fixed.
- Staff/view-only customize **title + statuses** of their two queue tiles only.

## Approach

Four fixed sections. Two left-column "slots" are configurable tiles; the right rail
(Starred + Since last login) is fixed. Per-user configuration lives in the existing
`users.preferences` JSON, seeded by role defaults. **One** new DB column
(`users.lastSignoutAt`) and **one** new endpoint (`GET /api/today/activity`);
everything else reuses existing schema, endpoints, and components.

---

## 1. Placement & shell

- New **Today** item at the top of the JOBS group in
  `client/src/components/sidebar.tsx`, rendered as a tab through the existing
  `renderTabContent()` switch in `client/src/pages/dashboard.tsx`, with a label in
  `client/src/components/topbar.tsx`. No new routing primitives.
- Page header: greeting `Good {timeOfDay}, {firstName} — {N} jobs need a hand today`
  + date/time (mirrors the mock).
- No fixed "pulse strip" for staff (the greeting carries the headline; owner/manager
  get numbers via the optional Stats tile — avoids two stats surfaces).

## 2. Default-view user setting

- Add `preferences.defaultView: 'today' | 'worklist'` (default `'today'`).
- Editable in `client/src/components/user-settings-modal.tsx` (a small selector next
  to font size / dark mode).
- Drives the initial tab in `dashboard.tsx` (`getInitialTab()` falls back to
  `preferences.defaultView` when no tab is in the URL).

## 3. Tile model (data)

Per-user config stored in `users.preferences.todayConfig`:

```ts
type TileType = 'queue' | 'analytics' | 'stats' | 'team';
type QueueMode = 'outreach' | 'chase';
type ActivityType = 'comment' | 'status_change' | 'overdue' | 'star_note';

interface SlotConfig {
  type: TileType;
  // queue-only fields:
  mode?: QueueMode;        // fixed per default slot; 'outreach' = Call patients, 'chase' = Chase the lab
  title?: string;
  statusIds?: string[];    // office status IDs this queue shows
}

interface TodayConfig {
  slots: [SlotConfig, SlotConfig];   // left column, exactly 2 slots
  activityFilter: ActivityType[];    // Since-last-login action types
}
```

- Persisted through the **existing** `PUT /api/user/preferences` (JSON merge). No
  schema change for config.
- `shared/today-defaults.ts` exports `DEFAULT_TODAY_CONFIG` (per role) + the activity
  catalog. Used when `preferences.todayConfig` is absent.

### Role defaults (`DEFAULT_TODAY_CONFIG`)

All roles start identical; the **capability** to swap non-queue tiles differs (see §5):

```ts
const baseSlots = [
  { type: 'queue', mode: 'outreach', title: 'Call patients — ready for pickup',
    statusIds: ['ready_for_pickup'] },
  { type: 'queue', mode: 'chase', title: 'Chase the lab — sitting too long',
    statusIds: ['job_created', 'sent_to_lab', 'in_progress'] },
];
const baseActivity = ['comment', 'overdue', 'star_note'];  // status_change available but OFF by default
```

- `owner`, `manager`, `staff`, `view_only` → same defaults.
- Default `statusIds` are validated against the office's actual `customStatuses` at
  read time; unknown IDs are filtered out (offices may have renamed/removed statuses).

## 4. Left column — Job queue tiles (all roles)

Editable per tile: **title + statuses** (nothing else). Each default slot has a fixed
`mode`.

**Membership rule (both modes):** jobs whose current `status` is in `statusIds`.
Sort by `statusChangedAt` ascending (longest-waiting first). `notificationRules`
thresholds drive only the red/amber urgency coloring, not membership.

### Slot 1 — `outreach` ("Call patients")
Row: patient name · job-type badge · **how long it's been ready** (from
`statusChangedAt`) · last-contact line · **Called / Texted** buttons.

- **Called/Texted = one-tap log + optional note.** Tapping immediately POSTs a
  comment (`Called — 2:43 PM` / `Texted — 2:43 PM`) to the job and the button shows a
  `✓ Called 2:43 PM` stamp. A small optional note field lets the user append detail
  ("picking up Saturday"); if filled, it's included in the comment. Tapping an active
  stamp **undoes** it (deletes that just-added comment).
- These are normal comments (`isOverdueComment=false`).
- Row click → job-details modal opened to the **Comments** tab.
- Scrollable list. "View all N ready for pickup →" footer links to the matching
  Worklist/Overdue filter.

### Slot 2 — `chase` ("Chase the lab")
Row: patient name · job-type badge · `Lab · Status` · **the last comment made while
overdue** · days-in-status · **Call / Comments** buttons.

- **Call** reveals the lab's phone number if present; if absent, prompts the user to
  add it inline, which saves the phone to that lab in office settings (§7).
- **Comments** opens the comment composer; comments added here are written with
  `isOverdueComment=true`, so the history marks them "added while overdue" (the
  existing badge in `job-comments-panel.tsx` renders it).
- "Last comment made while overdue" = most recent `jobComment` with
  `isOverdueComment=true` for that job.
- Row click → job-details modal on the **Comments** tab. Scrollable.

> Implementation note: confirm how `isOverdueComment` is currently set (client-passed
> vs server-detected in `server/routes.ts` POST `/api/jobs/:jobId/comments`) and make
> the Chase composer set/keep it `true`. The plan includes a verification step.

## 5. Owner/manager swap options (per slot)

Owner/manager can change a slot's `type` away from `queue`:

- **`analytics`** — compact card of key office KPIs, reusing existing analytics data
  (`client/src/components/analytics-dashboard.tsx` data sources). Summary, not the
  full Analytics page.
- **`stats`** — shows the key stats at once from already-loaded data (ready-to-call,
  overdue, open backlog, starred/remember count, oldest job age). No metric-picking.
  ("Completed this week" is deferred — it needs an extra archived-jobs query and
  isn't in the mock; add later if wanted.)
- **`team`** — office-wide recent activity (reuses the `/api/today/activity` query
  without the per-user `since`/personal filter).

Staff & view-only slots are locked to `type: 'queue'`. Enforced both in the Edit UI
(tile-type selector hidden) and server-side preference validation is unnecessary
(preferences are per-user and non-privileged), but the Today page renders staff
non-queue slots as queues defensively.

## 6. Right rail — fixed, all roles

### Remember — starred
- Title drops "flagged" → "Remember — starred".
- Shows **all starred jobs** office-wide (reuse `GET /api/jobs/flagged` as-is).
- Each row adds the job's **current status** (badge) alongside name · type and the
  star note (`importantNote`).
- Row click → job-details modal. Not customizable. Scrollable.

### Since last login
- Per-user **action filter** (`activityFilter`). Catalog: New comments ·
  Status changes · Newly overdue · Stars & notes. Default on: comments, overdue,
  star_note (status_change available but off).
- **Boundary** = the user's previous sign-out (`users.lastSignoutAt`); header shows
  that timestamp ("yesterday 6 PM"). Fallback when null: last 24h.
- Each row: actor initials avatar · `{Actor} {verb} {Job}` · optional detail
  (comment/note text) · relative time. Row click → job-details modal.
- Scrollable. *(Title uses "Since last login" per the rename; the mock's "Since you
  were here" wording is cosmetic.)*

## 7. Lab phone

- Extend lab items with optional `phone`:
  `office.settings.customOrderDestinations[].phone?: string`.
- Small extension to `client/src/components/customization/sortable-list-editor.tsx`
  to render a phone input for `destinations`-type lists (conditional field).
- Surfaced in **Settings → Labs** and **setup-wizard `step-destinations.tsx`**, plus
  the inline "add phone" prompt from the Chase *Call* button.
- Persists via the existing `PUT /api/offices/:id` settings merge. No new endpoint.

## 8. Data model & endpoints

**New:**
- Column `users.lastSignoutAt` (INTEGER ms, nullable). Added via an idempotent
  `ensureUserLastSignoutColumn()` guard in `server/sqlite-bootstrap.ts` (the repo's
  pattern for new `users` columns — covers fresh + existing installs); set on
  explicit logout (`server/auth.ts` `/api/logout`). Drives Since-last-login.
  - ponytail: only updated on explicit logout; if the app is just closed,
    boundary falls back to last 24h. Upgrade path: per-request `lastSeenAt`
    heartbeat if the fallback proves insufficient.
- Endpoint `GET /api/today/activity` → merged feed since the caller's
  `lastSignoutAt`, filtered to the requested action types (default: the user's
  saved `activityFilter`). Merges `jobComments`, `jobStatusHistory`, `jobFlags`
  (stars/notes), and newly-overdue jobs (computed from `notificationRules` +
  `statusChangedAt`), sorted desc. Office-scoped. Team-activity tile calls it with
  an office-wide window instead of personal `since`.
- Endpoint `GET /api/jobs/overdue-comments?jobIds=…` → batch lookup returning the
  latest `isOverdueComment=true` comment per requested job (one query), so the
  Chase tile can show "last comment made while overdue" without N requests.

**Reused as-is:**
- `GET /api/jobs` — client-side status filtering for both queues.
- `GET /api/jobs/flagged` — Starred rail.
- `POST/DELETE /api/jobs/:jobId/comments` — Called/Texted stamps + Chase comments.
- `PUT /api/user/preferences` — todayConfig, activityFilter, defaultView.
- `PUT /api/offices/:id` — lab phone.

## 9. Components (new, under `client/src/components/today/`)

- `today.tsx` — page: header + left slots + right rail; owns one `JobDetailsModal`
  instance + local open/tab state (the `important-jobs.tsx` pattern).
- `job-queue-tile.tsx` — renders a queue in `outreach` or `chase` mode.
- `starred-tile.tsx` — Remember list (all starred + current status).
- `activity-tile.tsx` — Since-last-login feed.
- `analytics-tile.tsx`, `stats-tile.tsx`, `team-activity-tile.tsx` — owner/manager
  tiles.
- `tile-edit-popover.tsx` — Edit UI (title + status checklist; tile-type selector
  for owner/manager; activity-type checkboxes).
- `call-lab-button.tsx` — Call button with phone reveal / add-phone prompt.
- `shared/today-defaults.ts` — `DEFAULT_TODAY_CONFIG`, activity catalog, helpers.

## 10. Edit UX

A small gear/Edit affordance on each editable section header opens a popover:
- Queue tile: title input + status checklist (office `customStatuses`) [+ tile-type
  selector for owner/manager].
- Since last login: action-type checkboxes.
- Starred: no Edit (fixed).
Saves optimistically via `PUT /api/user/preferences`.

## 11. Testing approach

The repo uses **Node's built-in test runner** (`node:test` + `node:assert/strict`,
run via `node --import tsx --test tests/<name>.test.ts`), with a `test:<name>`
script per file in `package.json` and a `test:all` aggregator. Tests live in
`tests/` and import `shared/`/`server/` logic by relative path. No Vitest, no
React component tests.

- **Pure logic** gets unit tests in this style:
  - `shared/today-defaults.ts`: role-default resolution, status-ID validation/filtering.
  - Queue membership + sort given a job set and `statusIds`.
  - "Last overdue comment" selection.
  - Activity-feed merge/sort/filter given fixture rows.
  - `lastSignoutAt` boundary + 24h fallback.
- **Server**: `GET /api/today/activity` integration test (since-boundary, type filter,
  office scoping).
- UI wiring is verified manually in the Electron app (preview tools / run skill).

## 12. Assumed defaults (flagged for review)

- `defaultView` initial value = `'today'` for all users (changeable in User Settings).
- Chase default statuses = the seeded in-lab IDs `['job_created', 'ordered', 'in_progress', 'delayed']` (validated against the office's actual `customStatuses` at read time).
- "Since last login" title (not "Since you were here").
- Edit affordance = per-section gear (not a page-level edit mode).
- Lab phone stored on the lab item (not a separate `labPhones` map).
