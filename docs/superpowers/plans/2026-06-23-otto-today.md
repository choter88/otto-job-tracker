# Otto Today Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user, role-seeded **Today** dashboard with two configurable job-queue tiles (Call patients / Chase the lab), a fixed Starred rail, and a per-user "Since last login" activity feed.

**Architecture:** A new `today` tab rendered through the existing dashboard tab switch. Per-user config lives in the existing `users.preferences` JSON (no schema change for config), seeded by `DEFAULT_TODAY_CONFIG` per role. One new DB column (`users.lastSignoutAt`) and two new GET endpoints (`/api/today/activity`, `/api/jobs/overdue-comments`); everything else reuses existing schema, endpoints, and components.

**Tech Stack:** React + TypeScript (`client/src`, wouter, TanStack Query, shadcn/Radix, date-fns), Express (`server/`), Drizzle + better-sqlite3 (`shared/schema.ts`), custom runtime SQL migrations (`server/migrate.ts`). Tests: Node's built-in runner (`node --import tsx --test tests/<name>.test.ts`).

## Global Constraints

- **No new runtime dependency.** Reuse existing UI primitives (`Button`, `Badge`, `ScrollArea`, `Dialog`, `Popover`), `date-fns`, and TanStack Query.
- **Config storage is the existing `users.preferences` JSON** via `PUT /api/user/preferences`. That handler does a **shallow** top-level merge (`{...current, ...incoming}`), so always send the *whole* `todayConfig` / `defaultView` value, never a nested partial.
- **New columns on existing tables** use the idempotent `ensureXxx()` guards in `server/sqlite-bootstrap.ts` (the repo's pattern for `users` columns), which cover fresh + existing installs. Numbered `.sql` files in `server/migrations/` (applied by `server/migrate.ts`, next is 014) are the alternative for brand-new tables. Never use drizzle push/generate.
- **Status IDs are office-customizable** (`office.settings.customStatuses`, `{id,label,color,order}`). Default seeded IDs: `job_created, ordered, in_progress, delayed, quality_check, ready_for_pickup, completed, cancelled`. Validate stored `statusIds` against the office's current list at read time.
- **Comments tag overdue via `jobComments.isOverdueComment`** (boolean). The server already accepts it through `insertJobCommentSchema` but the client does not currently send it. Chase comments send `isOverdueComment: true`; Called/Texted stamps send `false` (default).
- **Tests:** `node:test` + `node:assert/strict`, one `test:<name>` script per file in `package.json`, added to the `test:all` chain. Pure logic only (no React component tests). UI verified by running the Electron app.
- **Roles:** `owner | manager | staff | view_only | super_admin`. Only `owner`/`manager` may set a slot to a non-`queue` tile type.

---

## File Structure

**New files:**
- `shared/today-defaults.ts` — config types, `DEFAULT_TODAY_CONFIG`, `resolveTodayConfig`, `selectQueueJobs`, `boundaryFor`, `ACTIVITY_CATALOG`, `ActivityFeedItem`, `mergeActivity`. Pure, shared by client + server + tests.
- `client/src/pages/today.tsx` — the Today page (header + 2 slots + right rail; owns one `JobDetailsModal`).
- `client/src/components/today/job-queue-tile.tsx` — queue tile (`outreach` | `chase`).
- `client/src/components/today/call-lab-button.tsx` — Call button with phone reveal/add.
- `client/src/components/today/starred-tile.tsx` — Remember (all starred + current status).
- `client/src/components/today/activity-tile.tsx` — one feed component used twice: `scope="me"` (Since last login) and `scope="office"` (Team activity).
- `client/src/components/today/stats-tile.tsx`, `analytics-tile.tsx` — owner/manager tiles.
- `client/src/components/today/tile-edit-popover.tsx` — Edit popover.
- `tests/today-defaults.test.ts`, `tests/today-activity.test.ts` — unit tests.

**Modified files:**
- `shared/schema.ts` — add `lastSignoutAt` to `users`.
- `server/sqlite-bootstrap.ts` — `ensureUserLastSignoutColumn` guard.
- `server/auth.ts` — set `lastSignoutAt` on logout.
- `server/routes.ts` — `GET /api/today/activity`, `GET /api/jobs/overdue-comments`.
- `server/storage.ts` — `getActivityFeed`, `getLastOverdueCommentByJob`, `setUserLastSignout`.
- `client/src/components/sidebar.tsx`, `client/src/pages/dashboard.tsx`, `client/src/components/topbar.tsx` — Today tab + default-view wiring.
- `client/src/components/user-settings-modal.tsx` — `defaultView` selector + `UserPreferences` type.
- `client/src/components/customization/sortable-list-editor.tsx` — optional `phone` on destinations.
- `client/src/components/job-comments-panel.tsx` — `addComment` accepts `isOverdueComment`.

---

## Task 1: Shared config module (`shared/today-defaults.ts`)

**Files:**
- Create: `shared/today-defaults.ts`
- Test: `tests/today-defaults.test.ts`

**Interfaces:**
- Produces: `TileType`, `QueueMode`, `ActivityType`, `SlotConfig`, `TodayConfig`, `DEFAULT_TODAY_CONFIG`, `defaultTodayConfig()`, `resolveTodayConfig(prefs, role, validStatusIds)`, `selectQueueJobs(jobs, statusIds)`, `boundaryFor(lastSignoutAt, nowMs)`, `ACTIVITY_CATALOG`, `DEFAULT_ACTIVITY_FILTER`.

- [ ] **Step 1: Write the failing test** — `tests/today-defaults.test.ts`

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultTodayConfig,
  resolveTodayConfig,
  selectQueueJobs,
  boundaryFor,
  ACTIVITY_CATALOG,
} from "../shared/today-defaults";

const VALID = ["job_created", "ordered", "in_progress", "ready_for_pickup", "completed"];

test("defaultTodayConfig: two queue slots + default activity filter", () => {
  const cfg = defaultTodayConfig();
  assert.equal(cfg.slots.length, 2);
  assert.equal(cfg.slots[0].mode, "outreach");
  assert.equal(cfg.slots[1].mode, "chase");
  assert.deepEqual(cfg.activityFilter, ["comment", "overdue", "star_note"]);
});

test("resolveTodayConfig: no prefs → role default", () => {
  const cfg = resolveTodayConfig(undefined, "staff", VALID);
  assert.equal(cfg.slots[0].statusIds?.[0], "ready_for_pickup");
});

test("resolveTodayConfig: filters out unknown status IDs", () => {
  const prefs = { todayConfig: { slots: [
    { type: "queue", mode: "outreach", title: "X", statusIds: ["ready_for_pickup", "gone"] },
    { type: "queue", mode: "chase", title: "Y", statusIds: ["bogus"] },
  ], activityFilter: ["comment"] } };
  const cfg = resolveTodayConfig(prefs, "staff", VALID);
  assert.deepEqual(cfg.slots[0].statusIds, ["ready_for_pickup"]);
  // slot 1 had only invalid IDs → falls back to default chase statuses (validated)
  assert.ok(cfg.slots[1].statusIds!.length > 0);
});

test("resolveTodayConfig: staff cannot keep a non-queue tile", () => {
  const prefs = { todayConfig: { slots: [
    { type: "stats" }, { type: "queue", mode: "chase", statusIds: ["ordered"] },
  ], activityFilter: ["comment"] } };
  const cfg = resolveTodayConfig(prefs, "staff", VALID);
  assert.equal(cfg.slots[0].type, "queue");
});

test("resolveTodayConfig: owner may keep a non-queue tile", () => {
  const prefs = { todayConfig: { slots: [
    { type: "stats" }, { type: "queue", mode: "chase", statusIds: ["ordered"] },
  ], activityFilter: ["comment"] } };
  const cfg = resolveTodayConfig(prefs, "owner", VALID);
  assert.equal(cfg.slots[0].type, "stats");
});

test("resolveTodayConfig: drops unknown activity types, never empty", () => {
  const prefs = { todayConfig: { slots: defaultTodayConfig().slots, activityFilter: ["bogus"] } };
  const cfg = resolveTodayConfig(prefs, "staff", VALID);
  assert.deepEqual(cfg.activityFilter, ["comment", "overdue", "star_note"]);
});

test("selectQueueJobs: filters by status, sorts oldest-first", () => {
  const jobs = [
    { id: "a", status: "ready_for_pickup", statusChangedAt: 300 },
    { id: "b", status: "completed", statusChangedAt: 100 },
    { id: "c", status: "ready_for_pickup", statusChangedAt: 100 },
  ];
  const out = selectQueueJobs(jobs, ["ready_for_pickup"]);
  assert.deepEqual(out.map((j) => j.id), ["c", "a"]);
});

test("boundaryFor: uses lastSignout when present, else now-24h", () => {
  assert.equal(boundaryFor(5000, 9000), 5000);
  assert.equal(boundaryFor(null, 9000), 9000 - 24 * 60 * 60 * 1000);
  assert.equal(boundaryFor(0, 9000), 9000 - 24 * 60 * 60 * 1000);
});

test("ACTIVITY_CATALOG has the four agreed types", () => {
  assert.deepEqual(ACTIVITY_CATALOG.map((a) => a.type),
    ["comment", "status_change", "overdue", "star_note"]);
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `node --import tsx --test tests/today-defaults.test.ts`
Expected: FAIL — cannot find module `../shared/today-defaults`.

- [ ] **Step 3: Implement `shared/today-defaults.ts`**

```ts
// Per-user "Today" dashboard configuration. Pure data + helpers, shared by the
// client, the server, and tests. No imports from app code.

export type TileType = "queue" | "analytics" | "stats" | "team";
export type QueueMode = "outreach" | "chase";
export type ActivityType = "comment" | "status_change" | "overdue" | "star_note";

export interface SlotConfig {
  type: TileType;
  // queue-only fields:
  mode?: QueueMode; // "outreach" = Call patients, "chase" = Chase the lab
  title?: string;
  statusIds?: string[];
}

export interface TodayConfig {
  slots: [SlotConfig, SlotConfig];
  activityFilter: ActivityType[];
}

export const ACTIVITY_CATALOG: { type: ActivityType; label: string }[] = [
  { type: "comment", label: "New comments" },
  { type: "status_change", label: "Status changes" },
  { type: "overdue", label: "Newly overdue" },
  { type: "star_note", label: "Stars & notes" },
];

export const DEFAULT_ACTIVITY_FILTER: ActivityType[] = ["comment", "overdue", "star_note"];

// Default queue statuses reference the seeded office customStatuses IDs; they are
// validated against the office's actual list in resolveTodayConfig.
export function defaultTodayConfig(): TodayConfig {
  return {
    slots: [
      { type: "queue", mode: "outreach", title: "Call patients — ready for pickup",
        statusIds: ["ready_for_pickup"] },
      { type: "queue", mode: "chase", title: "Chase the lab — sitting too long",
        statusIds: ["job_created", "ordered", "in_progress", "delayed"] },
    ],
    activityFilter: [...DEFAULT_ACTIVITY_FILTER],
  };
}

// Per-role defaults. Currently identical; the capability to set non-queue tiles
// is gated by role in resolveTodayConfig (and the Edit UI), not by the defaults.
export const DEFAULT_TODAY_CONFIG: Record<string, TodayConfig> = {
  owner: defaultTodayConfig(),
  manager: defaultTodayConfig(),
  staff: defaultTodayConfig(),
  view_only: defaultTodayConfig(),
  super_admin: defaultTodayConfig(),
};

const PRIVILEGED_ROLES = new Set(["owner", "manager"]);

function readStoredConfig(prefs: unknown): TodayConfig | null {
  if (!prefs || typeof prefs !== "object") return null;
  const raw = (prefs as Record<string, unknown>).todayConfig;
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as Partial<TodayConfig>;
  if (!Array.isArray(cfg.slots) || cfg.slots.length !== 2) return null;
  return cfg as TodayConfig;
}

export function resolveTodayConfig(
  prefs: unknown,
  role: string,
  validStatusIds: string[],
): TodayConfig {
  const base = DEFAULT_TODAY_CONFIG[role] ?? defaultTodayConfig();
  const stored = readStoredConfig(prefs) ?? base;
  const validSet = new Set(validStatusIds);
  const privileged = PRIVILEGED_ROLES.has(role);

  const slots = stored.slots.map((slot, i): SlotConfig => {
    const fallback = base.slots[i] ?? defaultTodayConfig().slots[i];
    if (slot.type !== "queue") {
      // Non-queue tiles are owner/manager only; coerce others to the base queue.
      return privileged ? slot : fallback;
    }
    const validIds = (slot.statusIds ?? []).filter((id) => validSet.has(id));
    const safeIds = validIds.length
      ? validIds
      : (fallback.statusIds ?? []).filter((id) => validSet.has(id));
    return { type: "queue", mode: slot.mode ?? fallback.mode, title: slot.title ?? fallback.title, statusIds: safeIds };
  }) as [SlotConfig, SlotConfig];

  const filter = (stored.activityFilter ?? DEFAULT_ACTIVITY_FILTER).filter(
    (t): t is ActivityType => ACTIVITY_CATALOG.some((a) => a.type === t),
  );

  return { slots, activityFilter: filter.length ? filter : [...DEFAULT_ACTIVITY_FILTER] };
}

function toMs(v: number | Date): number {
  return v instanceof Date ? v.getTime() : Number(v) || 0;
}

// Queue membership: jobs whose current status is in statusIds, oldest-first
// (longest time since entering the current status).
export function selectQueueJobs<T extends { status: string; statusChangedAt: number | Date }>(
  jobs: T[],
  statusIds: string[],
): T[] {
  const set = new Set(statusIds);
  return jobs
    .filter((j) => set.has(j.status))
    .sort((a, b) => toMs(a.statusChangedAt) - toMs(b.statusChangedAt));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Boundary for the "Since last login" feed: the user's last sign-out, or the
// last 24h when we have no recorded sign-out (e.g. app closed without logout).
export function boundaryFor(lastSignoutAt: number | null | undefined, nowMs: number): number {
  return typeof lastSignoutAt === "number" && lastSignoutAt > 0 ? lastSignoutAt : nowMs - DAY_MS;
}

// --- Activity feed (used by server getActivityFeed + the client tiles) ---

export interface ActivityFeedItem {
  id: string;            // e.g. "comment:<commentId>"
  type: ActivityType;
  at: number;            // ms
  jobId: string;
  jobLabel: string;      // "Peter Cho · Glasses"
  actor: { id: string; firstName: string; lastName: string } | null;
  verb: string;          // "commented on" | "moved to In Progress" | "starred" | "became overdue"
  detail?: string;       // comment text / note
}

// Pure: filter to events after `since` of the chosen types, newest first.
export function mergeActivity(
  items: ActivityFeedItem[],
  sinceMs: number,
  types: ActivityType[],
): ActivityFeedItem[] {
  const allow = new Set(types);
  return items.filter((i) => i.at > sinceMs && allow.has(i.type)).sort((a, b) => b.at - a.at);
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `node --import tsx --test tests/today-defaults.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Register the test script & commit**

Add to `package.json` scripts (next to the others):
```json
"test:today-defaults": "node --import tsx --test tests/today-defaults.test.ts",
```
Append `&& npm run test:today-defaults` to the `test:all` script chain.

```bash
git add shared/today-defaults.ts tests/today-defaults.test.ts package.json
git commit -m "feat(today): shared config + helpers for the Today dashboard"
```

---

## Task 2: `users.lastSignoutAt` column + logout wiring

**Files:**
- Modify: `shared/schema.ts:14-34` (users table)
- Modify: `server/sqlite-bootstrap.ts` (add `ensureUserLastSignoutColumn` guard)
- Modify: `server/storage.ts` (add `setUserLastSignout`)
- Modify: `server/auth.ts:368-376` (logout handler)

**Interfaces:**
- Produces: `users.lastSignoutAt` (timestamp_ms, nullable); `storage.setUserLastSignout(userId)`.

- [ ] **Step 1: Add the column to the schema** — `shared/schema.ts`, inside the `users` table, immediately after the `updatedAt` field:

```ts
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
    lastSignoutAt: integer("last_signout_at", { mode: "timestamp_ms" }),
```

- [ ] **Step 2: Add a bootstrap column-guard** — the repo adds new user columns via idempotent `ensureXxx()` guards in `server/sqlite-bootstrap.ts` (e.g. `ensureUserPreferencesColumn`), which cover **both** fresh installs and existing DBs in one place. Mirror that pattern rather than a numbered migration.

Define (next to the other `ensureXxx` functions):
```ts
function ensureUserLastSignoutColumn() {
  const cols = sqlite.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "last_signout_at")) {
    sqlite.prepare(`ALTER TABLE users ADD COLUMN last_signout_at INTEGER`).run();
  }
}
```
Call it in the bootstrap transaction alongside the others (after `ensureUserPreferencesColumn();`):
```ts
    ensureUserPreferencesColumn();
    ensureUserLastSignoutColumn();
```
(Match the exact `sqlite` handle / scope used by the neighbouring `ensureXxx` functions in that file.)

- [ ] **Step 3: Add the storage helper** — `server/storage.ts`, near the other user methods:

```ts
  async setUserLastSignout(userId: string, atMs: number = Date.now()): Promise<void> {
    await db.update(users).set({ lastSignoutAt: new Date(atMs) }).where(eq(users.id, userId));
  }
```

- [ ] **Step 4: Set it on logout** — `server/auth.ts`, replace the handler at lines 368-376:

```ts
  app.post("/api/logout", async (req, res, next) => {
    const user = req.user as SelectUser | undefined;
    const { trackEvent } = require("./usage-tracker");
    trackEvent({ userId: user?.id, officeId: user?.officeId, eventType: "user_logout" });
    if (user?.id) {
      try { await storage.setUserLastSignout(user.id); } catch { /* non-critical */ }
    }
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });
```
(Ensure `storage` is imported in `auth.ts`; it already imports from `./storage` for login — confirm and add if missing.)

- [ ] **Step 5: Verify the column applies on boot**

Start the server once (run skill / `npm run dev`). Confirm no startup error. Then `PRAGMA table_info(users);` (sqlite shell on the data dir DB) includes `last_signout_at`. Re-running boot is a no-op (the guard is idempotent).

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts server/sqlite-bootstrap.ts server/storage.ts server/auth.ts
git commit -m "feat(today): record users.lastSignoutAt on logout"
```

---

## Task 3: Activity-feed storage + `GET /api/today/activity`

**Files:**
- Modify: `server/storage.ts` (add `getActivityFeed`)
- Modify: `server/routes.ts` (add route)
- Test: `tests/today-activity.test.ts` (pure merge/sort/filter helper)

**Interfaces:**
- Consumes: `boundaryFor`, `mergeActivity`, `ActivityFeedItem` (all from Task 1); `getOverdueJobs` (existing, `storage.ts:1551`); `storage.getOffice` (for status labels).
- Produces: `storage.getActivityFeed(officeId, sinceMs, types)`; `GET /api/today/activity?types=a,b&scope=me|office`.

> `ActivityFeedItem` and `mergeActivity` are defined in Task 1 (`shared/today-defaults.ts`). This task only adds the server query + route + their test.

- [ ] **Step 1: Write the failing test for the pure merge helper** — `tests/today-activity.test.ts`

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mergeActivity } from "../shared/today-defaults";

test("mergeActivity: filters by type, sorts desc, applies since", () => {
  const items = [
    { id: "comment:1", type: "comment", at: 300, jobId: "j", jobLabel: "A", actor: null, verb: "commented on" },
    { id: "status:1", type: "status_change", at: 500, jobId: "j", jobLabel: "A", actor: null, verb: "moved" },
    { id: "old:1", type: "comment", at: 50, jobId: "j", jobLabel: "A", actor: null, verb: "commented on" },
  ] as any[];
  const out = mergeActivity(items, 100, ["comment"]);
  assert.deepEqual(out.map((i) => i.id), ["comment:1"]); // status filtered out; old:1 before since
});
```

- [ ] **Step 2: Run to confirm pass** (`mergeActivity` is implemented in Task 1)

Run: `node --import tsx --test tests/today-activity.test.ts`. Expected: PASS. Register `test:today-activity` in `package.json` + the `test:all` chain.

- [ ] **Step 3: Implement `getActivityFeed` in `server/storage.ts`**

Mirror the join pattern from `getFlaggedJobsByOffice` (storage.ts:703). Fetch, since `sinceMs`, office-scoped:
- comments (`jobComments` ⋈ `users` ⋈ `jobs` for label), `createdAt > since`
- status changes (`jobStatusHistory` ⋈ `users` ⋈ `jobs`), `changedAt > since`
- stars & notes (`jobFlags` ⋈ `users` ⋈ `jobs`) where `createdAt > since` OR `importantNoteUpdatedAt > since`
- newly overdue: `getOverdueJobs(officeId)` filtered to those whose overdue-crossing time (`statusChangedAt + rule.maxDays*DAY`) `> since`

```ts
  async getActivityFeed(
    officeId: string,
    sinceMs: number,
    types: import("@shared/today-defaults").ActivityType[],
  ): Promise<import("@shared/today-defaults").ActivityFeedItem[]> {
    const since = new Date(sinceMs);
    const label = (fn: string, ln: string | null, jt: string) => `${fn} ${ln ?? ""}`.trim();
    const items: import("@shared/today-defaults").ActivityFeedItem[] = [];

    // Status-label map so the feed reads "moved to Ready for Pickup", not "ready_for_pickup".
    const office = await this.getOffice(officeId);
    const statusLabelById = new Map<string, string>(
      ((office?.settings as any)?.customStatuses ?? []).map((s: any) => [s.id, s.label]),
    );

    if (types.includes("comment")) {
      const rows = await db
        .select({
          id: jobComments.id, content: jobComments.content, at: jobComments.createdAt,
          jobId: jobs.id, pfn: jobs.patientFirstName, pln: jobs.patientLastName, jobType: jobs.jobType,
          aId: users.id, aFn: users.firstName, aLn: users.lastName,
        })
        .from(jobComments)
        .innerJoin(jobs, eq(jobs.id, jobComments.jobId))
        .innerJoin(users, eq(users.id, jobComments.authorId))
        .where(and(eq(jobs.officeId, officeId), gt(jobComments.createdAt, since)));
      for (const r of rows) items.push({
        id: `comment:${r.id}`, type: "comment", at: (r.at as Date).getTime(),
        jobId: r.jobId, jobLabel: `${label(r.pfn, r.pln, r.jobType)}`,
        actor: { id: r.aId, firstName: r.aFn, lastName: r.aLn },
        verb: "commented on", detail: r.content,
      });
    }

    if (types.includes("status_change")) {
      const rows = await db
        .select({
          id: jobStatusHistory.id, newStatus: jobStatusHistory.newStatus, at: jobStatusHistory.changedAt,
          jobId: jobs.id, pfn: jobs.patientFirstName, pln: jobs.patientLastName,
          aId: users.id, aFn: users.firstName, aLn: users.lastName,
        })
        .from(jobStatusHistory)
        .innerJoin(jobs, eq(jobs.id, jobStatusHistory.jobId))
        .innerJoin(users, eq(users.id, jobStatusHistory.changedBy))
        .where(and(eq(jobs.officeId, officeId), gt(jobStatusHistory.changedAt, since)));
      for (const r of rows) items.push({
        id: `status:${r.id}`, type: "status_change", at: (r.at as Date).getTime(),
        jobId: r.jobId, jobLabel: `${r.pfn} ${r.pln ?? ""}`.trim(),
        actor: { id: r.aId, firstName: r.aFn, lastName: r.aLn },
        verb: `moved to ${statusLabelById.get(r.newStatus) ?? r.newStatus}`,
      });
    }

    if (types.includes("star_note")) {
      const rows = await db
        .select({
          id: jobFlags.id, note: jobFlags.importantNote, createdAt: jobFlags.createdAt,
          noteAt: jobFlags.importantNoteUpdatedAt, jobId: jobs.id,
          pfn: jobs.patientFirstName, pln: jobs.patientLastName,
          aId: users.id, aFn: users.firstName, aLn: users.lastName,
        })
        .from(jobFlags)
        .innerJoin(jobs, eq(jobs.id, jobFlags.jobId))
        .innerJoin(users, eq(users.id, jobFlags.userId))
        .where(eq(jobs.officeId, officeId));
      for (const r of rows) {
        const createdMs = (r.createdAt as Date).getTime();
        const noteMs = r.noteAt ? (r.noteAt as Date).getTime() : 0;
        const at = Math.max(createdMs, noteMs);
        if (at <= sinceMs) continue;
        items.push({
          id: `flag:${r.id}:${at}`, type: "star_note", at,
          jobId: r.jobId, jobLabel: `${r.pfn} ${r.pln ?? ""}`.trim(),
          actor: { id: r.aId, firstName: r.aFn, lastName: r.aLn },
          verb: noteMs >= createdMs && r.note ? "noted" : "starred",
          detail: r.note ?? undefined,
        });
      }
    }

    if (types.includes("overdue")) {
      const overdue = await this.getOverdueJobs(officeId);
      const DAY = 24 * 60 * 60 * 1000;
      for (const j of overdue) {
        const crossing = (j.statusChangedAt as Date).getTime() + (j.rule?.maxDays ?? 0) * DAY;
        if (crossing <= sinceMs) continue;
        items.push({
          id: `overdue:${j.id}`, type: "overdue", at: crossing,
          jobId: j.id, jobLabel: `${j.patientFirstName} ${j.patientLastName ?? ""}`.trim(),
          actor: null, verb: "became overdue",
        });
      }
    }

    return items.sort((a, b) => b.at - a.at);
  }
```
(Ensure `gt` is imported from `drizzle-orm` in storage.ts alongside `eq, and, lte, desc, asc, inArray`.)

- [ ] **Step 4: Add the route** — `server/routes.ts`, near the other `/api/jobs` reads:

```ts
  app.get("/api/today/activity", requireOffice, async (req, res) => {
    try {
      const user = getAuthUser(req);
      const officeId = getOfficeUser(req).officeId;
      const scope = req.query.scope === "office" ? "office" : "me";
      const typesParam = typeof req.query.types === "string" ? req.query.types : "";
      const types = typesParam
        ? (typesParam.split(",").filter(Boolean) as any)
        : ["comment", "overdue", "star_note"];
      const lastSignout = user.lastSignoutAt ? new Date(user.lastSignoutAt as any).getTime() : null;
      const since = scope === "office"
        ? Date.now() - 24 * 60 * 60 * 1000           // team tile: rolling 24h window
        : boundaryFor(lastSignout, Date.now());       // personal: since last sign-out
      const feed = await storage.getActivityFeed(officeId, since, types);
      res.json({ since, items: feed });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
```
Add `import { boundaryFor } from "@shared/today-defaults";` to routes.ts.

- [ ] **Step 5: Verify + commit**

Run the app, log in, hit `GET /api/today/activity` (the activity tile in Task 12 exercises it; for now curl with a session cookie or verify via the Network panel). Confirm `{ since, items: [...] }`.

```bash
git add shared/today-defaults.ts tests/today-activity.test.ts server/storage.ts server/routes.ts package.json
git commit -m "feat(today): activity feed endpoint + merge helper"
```
(Register `test:today-activity` in package.json + `test:all` as in Task 1 Step 5.)

---

## Task 4: `GET /api/jobs/overdue-comments` (last overdue comment per job)

**Files:**
- Modify: `server/storage.ts` (`getLastOverdueCommentByJob`)
- Modify: `server/routes.ts` (route)

**Interfaces:**
- Produces: `storage.getLastOverdueCommentByJob(jobIds): Promise<Record<string, JobCommentWithAuthor>>`; `GET /api/jobs/overdue-comments?jobIds=a,b,c`.

- [ ] **Step 1: Storage method** — `server/storage.ts`:

```ts
  async getLastOverdueCommentByJob(jobIds: string[]): Promise<Record<string, JobCommentWithAuthor>> {
    if (jobIds.length === 0) return {};
    const rows = await db
      .select({
        id: jobComments.id, jobId: jobComments.jobId, authorId: jobComments.authorId,
        content: jobComments.content, isOverdueComment: jobComments.isOverdueComment,
        createdAt: jobComments.createdAt,
        author: { id: users.id, firstName: users.firstName, lastName: users.lastName },
      })
      .from(jobComments)
      .innerJoin(users, eq(users.id, jobComments.authorId))
      .where(and(inArray(jobComments.jobId, jobIds), eq(jobComments.isOverdueComment, true)))
      .orderBy(desc(jobComments.createdAt));
    const byJob: Record<string, JobCommentWithAuthor> = {};
    for (const r of rows) if (!byJob[r.jobId]) byJob[r.jobId] = r as JobCommentWithAuthor; // first = newest
    return byJob;
  }
```

- [ ] **Step 2: Route** — `server/routes.ts`:

```ts
  app.get("/api/jobs/overdue-comments", requireOffice, async (req, res) => {
    try {
      const ids = typeof req.query.jobIds === "string" && req.query.jobIds
        ? req.query.jobIds.split(",").filter(Boolean) : [];
      res.json(await storage.getLastOverdueCommentByJob(ids));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
```
(Office scoping: `jobIds` are client-supplied; the comments returned are only those whose jobs the office can see — acceptable since IDs come from the office's own `/api/jobs`. If stricter isolation is wanted, join `jobs` and filter by `officeId`.)

- [ ] **Step 3: Verify + commit**

```bash
git add server/storage.ts server/routes.ts
git commit -m "feat(today): batch last-overdue-comment lookup for the Chase tile"
```

---

## Task 5: Let the client tag a comment as overdue

**Files:**
- Modify: `client/src/components/job-comments-panel.tsx:42-49` (addCommentMutation)

**Interfaces:**
- Produces: `addCommentMutation` accepts `{ content, clientCommentId, isOverdueComment? }`.

`insertJobCommentSchema = createInsertSchema(jobComments).omit({ id, createdAt })` keeps every non-omitted column, so `isOverdueComment` already validates through. Make that explicit (and robust to any future strict-zod change) and wire the client to send it.

- [ ] **Step 0: Make the field explicit in the insert schema** — `shared/schema.ts`, in the `insertJobCommentSchema.extend({...})` block, add alongside the `id` override:

```ts
  .extend({
    id: z.string().min(1).optional(),
    isOverdueComment: z.boolean().optional(),
  });
```

- [ ] **Step 1: Update the mutation input + body** — replace lines 42-49:

```ts
  const addCommentMutation = useMutation({
    mutationFn: async (input: { content: string; clientCommentId: string; isOverdueComment?: boolean }) => {
      const res = await apiRequest("POST", `/api/jobs/${job.id}/comments`, {
        id: input.clientCommentId,
        content: input.content.trim(),
        ...(input.isOverdueComment ? { isOverdueComment: true } : {}),
      });
      return res.json();
    },
```
Update the optimistic `optimisticComment` object (lines ~62-73) to include `isOverdueComment: input.isOverdueComment ?? false,` so the badge renders immediately.

- [ ] **Step 2: Verify the existing call sites still compile**

`isOverdueComment` is optional, so existing `addCommentMutation.mutate({ content, clientCommentId })` calls are unaffected. Run `npm run check` (tsc) — expect no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/job-comments-panel.tsx
git commit -m "feat(today): allow comments to be tagged isOverdueComment from the client"
```

---

## Task 6: Today tab wiring + default-view consumption

**Files:**
- Modify: `client/src/components/sidebar.tsx:110-143` (jobsItems) + icon import
- Modify: `client/src/pages/dashboard.tsx:56-65, 144-165` (getInitialTab, renderTabContent, import)
- Modify: `client/src/components/topbar.tsx:13-24` (TAB_LABELS)

**Interfaces:**
- Consumes: `Today` page (Task 7) — import as `import Today from "@/pages/today";` (stub acceptable until Task 7).
- Produces: `today` tab id wired through sidebar/dashboard/topbar; `getInitialTab` honors `preferences.defaultView`.

- [ ] **Step 1: Add the sidebar item** — `sidebar.tsx`, add `Clock` to the lucide import, then prepend to `jobsItems`:

```ts
  const jobsItems: NavItem[] = [
    {
      id: "today",
      label: "Today",
      icon: Clock,
    },
    {
      id: "all",
      label: "Worklist",
      icon: Briefcase,
      badge: jobs.length || null,
    },
    // …unchanged…
```

- [ ] **Step 2: Topbar label** — `topbar.tsx`, add to `TAB_LABELS`:

```ts
const TAB_LABELS: Record<string, string> = {
  today: "Today",
  all: "Worklist",
  // …unchanged…
```

- [ ] **Step 3: Render the tab + honor defaultView** — `dashboard.tsx`:

Import at top: `import Today from "@/pages/today";`

Replace `getInitialTab` (lines 56-65) to fall back to the user's default view at the root URL:
```ts
  const [, importantParams] = useRoute("/important");
  const [, dashboardParams] = useRoute("/dashboard/:tab?");

  const getInitialTab = () => {
    if (importantParams) return "important";
    if (dashboardParams && dashboardParams.tab) return dashboardParams.tab;
    // No explicit tab in the URL → honor the user's saved default view.
    // Default is Today (the redesign's home); only an explicit "worklist" opts out.
    const dv = (user?.preferences as any)?.defaultView;
    return dv === "worklist" ? "all" : "today";
  };
```
Add a `case "today": return <Today />;` to `renderTabContent` (lines 144-165), before `default`.

Because the URL-sync `useEffect` depends on `[location]` and `getInitialTab` now reads `user`, also add `user?.id` to that effect's dependency array so the default applies once the user loads:
```ts
  }, [location, user?.id]);
```

- [ ] **Step 4: Verify**

Run the app. Expected: a **Today** item appears at the top of JOBS; clicking it shows the Today page (placeholder from Task 7) and the topbar reads "Today". With `preferences.defaultView` unset, the root `/` still lands on Worklist (Task 16 adds the toggle).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/sidebar.tsx client/src/components/topbar.tsx client/src/pages/dashboard.tsx
git commit -m "feat(today): wire Today tab into sidebar/dashboard/topbar"
```

---

## Task 7: Today page scaffold (`today.tsx`)

**Files:**
- Create: `client/src/pages/today.tsx`

**Interfaces:**
- Consumes: `resolveTodayConfig` (Task 1); `useAuth` (`user`); `/api/jobs`, `/api/offices/:id`, `JobDetailsModal`, `JobDetailsTab`.
- Produces: `export default function Today()`; renders header + two slot tiles + right rail; owns `JobDetailsModal` open/tab state and a `openJob(jobId, tab)` callback passed to children.

This task delivers the page shell with **placeholder tiles** (filled by Tasks 8–14). It establishes the data loads + modal plumbing.

- [ ] **Step 1: Implement the scaffold**

```tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { resolveTodayConfig } from "@shared/today-defaults";
import type { Job } from "@shared/schema";
import JobDetailsModal, { type JobDetailsTab } from "@/components/job-details-modal";

export default function Today() {
  const { user } = useAuth();
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: office } = useQuery<any>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const customStatuses: Array<{ id: string; label: string; color?: string; order?: number }> =
    office?.settings?.customStatuses ?? [];
  const validStatusIds = customStatuses.map((s) => s.id);

  const config = useMemo(
    () => resolveTodayConfig(user?.preferences, user?.role ?? "staff", validStatusIds),
    [user?.preferences, user?.role, validStatusIds.join(",")],
  );

  // Shared modal state (the important-jobs.tsx pattern).
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<JobDetailsTab>("overview");
  const openJob = (job: Job, tab: JobDetailsTab = "overview") => {
    setSelectedJob(job);
    setModalTab(tab);
    setModalOpen(true);
  };

  // Lookup for activity rows → full Job (so a feed row can open the modal).
  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  // Edit-popover triggers. Filled in by Task 13; declared here so tiles can
  // receive a stable handler from the first render.
  const openEditFor = (_slotIndex: number) => {}; // Task 13
  const openActivityEdit = () => {}; // Task 13

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-line bg-panel">
        <h1 className="text-2xl font-semibold text-ink">Today</h1>
        <p className="text-sm text-ink-2 mt-1">
          {greeting}, {user?.firstName} — <strong>{jobs.length} jobs</strong> need a hand today.
        </p>
      </header>

      <div className="flex-1 min-h-0 flex gap-4 p-6 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-auto flex flex-col gap-5">
          {/* Task 8/9/13: render config.slots[0] and config.slots[1] by type */}
          {config.slots.map((slot, i) => (
            <div key={i} data-testid={`today-slot-${i}`}>{/* tile goes here */}</div>
          ))}
        </div>
        <div className="w-[360px] flex-none flex flex-col gap-4 min-h-0">
          {/* Task 11: <StarredTile onOpenJob={openJob} /> */}
          {/* Task 12: <ActivityTile filter={config.activityFilter} onOpenJob={openJob} /> */}
        </div>
      </div>

      {selectedJob && (
        <JobDetailsModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          job={selectedJob}
          activeTab={modalTab}
          onActiveTabChange={setModalTab}
          onEditJob={() => { /* Today is read-first; edit reuses worklist flow if needed */ }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — clicking the Today tab renders the header + greeting + two empty slot containers + an empty right rail with no console errors. `preview_snapshot` shows "Today" and the greeting.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/today.tsx
git commit -m "feat(today): page scaffold with data loads + shared modal"
```

---

## Task 8: Job-queue tile — `outreach` mode (Call patients)

**Files:**
- Create: `client/src/components/today/job-queue-tile.tsx`
- Modify: `client/src/pages/today.tsx` (render slot when `type==="queue"`)

**Interfaces:**
- Consumes: `selectQueueJobs` (Task 1), `addCommentMutation`-style POST, `getStatusBadgeStyle`/`getTypeBadgeStyle`, `formatDistanceToNow`, `SlotConfig`, `openJob`.
- Produces: `<JobQueueTile slot={SlotConfig} jobs={Job[]} office={…} onOpenJob={(job, tab)=>void} onEdit={()=>void} />`.

This task implements the tile shell + **outreach** rows (Call/Text stamps). Chase rows come in Task 9.

- [ ] **Step 1: Implement the outreach tile**

```tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { getTypeBadgeStyle, getDestinationBadgeStyle } from "@/lib/default-colors";
import { selectQueueJobs, type SlotConfig } from "@shared/today-defaults";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";

interface Props {
  slot: SlotConfig;
  jobs: Job[];
  office: any;
  onOpenJob: (job: Job, tab: JobDetailsTab, overdue?: boolean) => void; // overdue flag added in Task 9
  onEdit: () => void;
}

const MAX_ROWS = 12;

export default function JobQueueTile({ slot, jobs, office, onOpenJob, onEdit }: Props) {
  const [, setLocation] = useLocation();
  const queued = selectQueueJobs(jobs, slot.statusIds ?? []);
  const visible = queued.slice(0, MAX_ROWS);

  return (
    <section>
      <header className="flex items-center gap-2 mb-3">
        <span className="font-semibold text-[15px] text-ink">{slot.title ?? "Call patients"}</span>
        <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-success-bg text-success">{queued.length}</span>
        <button className="ml-auto text-xs text-ink-mute hover:text-ink" onClick={onEdit} data-testid="today-tile-edit">Edit</button>
      </header>
      <div className="rounded-xl border border-line bg-panel overflow-hidden">
        {visible.length === 0 && <div className="p-6 text-center text-sm text-ink-mute">Nothing here right now.</div>}
        {visible.map((job, i) => (
          <OutreachRow key={job.id} job={job} office={office} first={i === 0} onOpen={() => onOpenJob(job, "comments")} />
        ))}
      </div>
      {queued.length > 0 && (
        <button
          className="block mx-auto mt-2 text-xs text-accent hover:underline"
          onClick={() => setLocation(slot.mode === "chase" ? "/dashboard/overdue" : "/dashboard/all")}
          data-testid="today-view-all"
        >
          View all {queued.length} {slot.mode === "chase" ? "overdue" : "ready for pickup"} →
        </button>
      )}
    </section>
  );
}

function OutreachRow({ job, office, first, onOpen }: { job: Job; office: any; first: boolean; onOpen: () => void }) {
  const typeStyle = getTypeBadgeStyle(job.jobType, office?.settings?.customJobTypes ?? []);
  const readyFor = formatDistanceToNow(new Date(job.statusChangedAt as any), { addSuffix: false });
  return (
    <div className={`flex items-center gap-4 px-4 py-3 ${first ? "" : "border-t border-line-2"}`}>
      <button className="flex-1 min-w-0 text-left" onClick={onOpen} data-testid={`today-row-${job.id}`}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-ink">{job.patientFirstName} {job.patientLastName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: typeStyle.background, color: typeStyle.text }}>{job.jobType}</span>
        </div>
        <div className="text-xs text-ink-mute mt-1">Ready {readyFor}</div>
      </button>
      <StampButtons jobId={job.id} />
    </div>
  );
}

function StampButtons({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  // ponytail: undo state is in-memory (the comment id we just created), so a
  // stamp can be undone within this view but not after a remount — fine for an
  // immediate "oops" correction; the comment is always editable in the modal.
  const [stamps, setStamps] = useState<{ called?: string; texted?: string }>({});

  const post = useMutation({
    mutationFn: async (kind: "Called" | "Texted") => {
      const id = `stamp-${jobId}-${kind}-${Date.now()}`;
      const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const content = note.trim() ? `${kind} — ${time} · ${note.trim()}` : `${kind} — ${time}`;
      await apiRequest("POST", `/api/jobs/${jobId}/comments`, { id, content });
      return { kind, id };
    },
    onSuccess: ({ kind, id }) => {
      setStamps((s) => ({ ...s, [kind.toLowerCase()]: id }));
      setNote("");
      qc.invalidateQueries({ queryKey: ["api/jobs", jobId, "comments"] });
      qc.invalidateQueries({ queryKey: ["api/jobs/comment-counts"] });
    },
  });

  const undo = useMutation({
    mutationFn: async (commentId: string) => { await apiRequest("DELETE", `/api/jobs/comments/${commentId}`); },
    onSuccess: (_d, commentId) => {
      setStamps((s) => (s.called === commentId ? { ...s, called: undefined } : { ...s, texted: undefined }));
      qc.invalidateQueries({ queryKey: ["api/jobs", jobId, "comments"] });
    },
  });

  const toggle = (kind: "Called" | "Texted") => {
    const existing = kind === "Called" ? stamps.called : stamps.texted;
    if (existing) undo.mutate(existing);
    else post.mutate(kind);
  };

  return (
    <div className="flex-none flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <Button size="xs" variant={stamps.called ? "secondary" : "outline"} onClick={() => toggle("Called")} data-testid={`stamp-called-${jobId}`}>
          {stamps.called ? "✓ Called" : "Called"}
        </Button>
        <Button size="xs" variant={stamps.texted ? "secondary" : "outline"} onClick={() => toggle("Texted")} data-testid={`stamp-texted-${jobId}`}>
          {stamps.texted ? "✓ Texted" : "Texted"}
        </Button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="optional note…"
        className="text-xs px-2 py-1 rounded border border-line-2 bg-paper w-40"
        data-testid={`stamp-note-${jobId}`}
      />
    </div>
  );
}
```

- [ ] **Step 2: Render it in `today.tsx`** — replace the slot map body:

```tsx
{config.slots.map((slot, i) =>
  slot.type === "queue" && slot.mode === "outreach" ? (
    <JobQueueTile key={i} slot={slot} jobs={jobs} office={office} onOpenJob={openJob} onEdit={() => openEditFor(i)} />
  ) : (
    <div key={i} data-testid={`today-slot-${i}`} />  // chase + owner tiles filled in later tasks
  )
)}
```
(`openEditFor` already exists from the Task 7 scaffold; it's wired to the real popover in Task 13.)

- [ ] **Step 3: Verify** — the Call-patients tile lists ready jobs sorted longest-waiting-first; tapping **Called** writes a comment (open the job's Comments tab to confirm "Called — H:MM") and flips the button to "✓ Called"; tapping again deletes it. Row click opens the modal on Comments.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/today/job-queue-tile.tsx client/src/pages/today.tsx
git commit -m "feat(today): Call-patients (outreach) queue tile with Called/Texted stamps"
```

---

## Task 9: Job-queue tile — `chase` mode (Chase the lab)

**Files:**
- Modify: `client/src/components/today/job-queue-tile.tsx` (add chase rows)
- Create: `client/src/components/today/call-lab-button.tsx`
- Modify: `client/src/pages/today.tsx` (render chase slot)

**Interfaces:**
- Consumes: `/api/jobs/overdue-comments` (Task 4), `getDestinationBadgeStyle`, `JobCommentsPanel` add path with `isOverdueComment` (Task 5), `CallLabButton` (this task).
- Produces: chase rows; `<CallLabButton job office onPhoneSaved />`.

- [ ] **Step 1: Add a chase branch + ChaseRow** to `job-queue-tile.tsx`. In the tile body, when `slot.mode === "chase"` fetch the last overdue comments for visible jobs and render `ChaseRow`:

```tsx
// inside JobQueueTile, before return:
const isChase = slot.mode === "chase";
const visibleIds = visible.map((j) => j.id).join(",");
const { data: lastOverdue = {} } = useQuery<Record<string, any>>({
  queryKey: ["/api/jobs/overdue-comments", visibleIds],
  queryFn: async () => {
    if (!visibleIds) return {};
    const res = await fetch(`/api/jobs/overdue-comments?jobIds=${encodeURIComponent(visibleIds)}`, { credentials: "include" });
    return res.ok ? res.json() : {};
  },
  enabled: isChase && visibleIds.length > 0,
});
```
Row renderer:
```tsx
function ChaseRow({ job, office, first, lastComment, onOpen, onPhoneSaved }:
  { job: Job; office: any; first: boolean; lastComment?: any; onOpen: () => void; onPhoneSaved: () => void }) {
  const destStyle = getDestinationBadgeStyle(job.orderDestination, office?.settings?.customOrderDestinations ?? []);
  const statusLabel = (office?.settings?.customStatuses ?? []).find((s: any) => s.id === job.status)?.label ?? job.status;
  const days = Math.floor((Date.now() - new Date(job.statusChangedAt as any).getTime()) / 86400000);
  const lab = (office?.settings?.customOrderDestinations ?? []).find((d: any) => d.id === job.orderDestination);
  return (
    <div className={`flex items-center gap-4 px-4 py-3 ${first ? "" : "border-t border-line-2"}`}>
      <button className="flex-1 min-w-0 text-left" onClick={onOpen}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-ink">{job.patientFirstName} {job.patientLastName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: destStyle.background, color: destStyle.text }}>{lab?.label ?? job.orderDestination}</span>
        </div>
        <div className="text-xs text-ink-mute mt-1 truncate">
          {statusLabel}{lastComment ? ` · “${lastComment.content}”` : " · no overdue note yet"}
        </div>
      </button>
      <div className="flex-none w-24 text-right">
        <div className="font-mono text-sm text-danger">{days} days</div>
        <div className="text-[10px] text-ink-mute">in status</div>
      </div>
      <div className="flex-none flex gap-2">
        <CallLabButton lab={lab} job={job} office={office} onPhoneSaved={onPhoneSaved} />
        <Button size="xs" variant="outline" onClick={onOpen} data-testid={`chase-comments-${job.id}`}>Comments</Button>
      </div>
    </div>
  );
}
```
Map `visible` to `ChaseRow` when `isChase`, passing `lastComment={lastOverdue[job.id]}` and `onOpen={() => onOpenJob(job, "comments")}`. Add `useQuery` import.

- [ ] **Step 2: Implement `call-lab-button.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import type { Job } from "@shared/schema";

export default function CallLabButton({ lab, job, office, onPhoneSaved }:
  { lab?: { id: string; label: string; phone?: string }; job: Job; office: any; onPhoneSaved: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const canEdit = user?.role === "owner" || user?.role === "manager";

  const save = useMutation({
    mutationFn: async (newPhone: string) => {
      const dests = (office?.settings?.customOrderDestinations ?? []).map((d: any) =>
        d.id === lab?.id ? { ...d, phone: newPhone.trim() } : d);
      const settings = { ...office.settings, customOrderDestinations: dests };
      await apiRequest("PUT", `/api/offices/${user?.officeId}`, { settings });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/offices", user?.officeId] }); onPhoneSaved(); setOpen(false); },
  });

  if (lab?.phone) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button size="xs" data-testid={`call-lab-${job.id}`}>Call</Button></PopoverTrigger>
        <PopoverContent className="w-auto"><a className="font-medium" href={`tel:${lab.phone}`}>{lab.label}: {lab.phone}</a></PopoverContent>
      </Popover>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="xs" variant="outline" data-testid={`call-lab-${job.id}`}>Call</Button></PopoverTrigger>
      <PopoverContent className="space-y-2">
        <p className="text-sm">No phone saved for {lab?.label ?? "this lab"}.</p>
        {canEdit ? (
          <>
            <input className="w-full text-sm px-2 py-1 rounded border border-line-2" placeholder="(555) 123-4567"
              value={phone} onChange={(e) => setPhone(e.target.value)} data-testid={`lab-phone-input-${job.id}`} />
            <Button size="xs" disabled={!phone.trim() || save.isPending} onClick={() => save.mutate(phone)}>Save to lab</Button>
          </>
        ) : <p className="text-xs text-ink-mute">Ask an owner/manager to add it in Settings → Labs.</p>}
      </PopoverContent>
    </Popover>
  );
}
```
(Note: `PUT /api/offices/:id` is `owner`/`manager` only — that's why save is gated. Staff see the "ask an owner/manager" message.)

- [ ] **Step 3: Wire Chase comments to tag overdue** — a comment composed from a chase-launched modal must POST `isOverdueComment: true`. Thread a flag down (four concrete edits):

  1. `client/src/components/job-comments-panel.tsx` — add `defaultOverdue?: boolean;` to `JobCommentsPanelProps`. In the composer submit handler, pass it through: `addCommentMutation.mutate({ content: newComment, clientCommentId: crypto.randomUUID(), isOverdueComment: defaultOverdue })` (Task 5 already added the `isOverdueComment` input).
  2. `client/src/components/job-details-modal.tsx` — add `commentsDefaultOverdue?: boolean;` to `JobDetailsModalProps`; pass it into the Comments tab: `<JobCommentsPanel job={job} defaultOverdue={commentsDefaultOverdue} />` (around line 950).
  3. `client/src/pages/today.tsx` — extend the modal state and opener:
```tsx
const [modalOverdue, setModalOverdue] = useState(false);
const openJob = (job: Job, tab: JobDetailsTab = "overview", overdue = false) => {
  setSelectedJob(job); setModalTab(tab); setModalOverdue(overdue); setModalOpen(true);
};
// …and on the modal: commentsDefaultOverdue={modalOverdue}
```
  4. The chase row's Comments/row click calls `onOpenJob(job, "comments", true)`; outreach/starred/activity keep `overdue = false` (default). Update the `onOpenJob` prop type to `(job: Job, tab: JobDetailsTab, overdue?: boolean) => void`.

- [ ] **Step 4: Render chase slot in `today.tsx`** — extend the slot map:
```tsx
slot.type === "queue" && slot.mode === "chase" ? (
  <JobQueueTile key={i} slot={slot} jobs={jobs} office={office} onOpenJob={openJob} onEdit={() => openEditFor(i)} />
) : ...
```

- [ ] **Step 5: Verify** — Chase tile lists in-lab jobs sorted longest-first with "N days in status", last overdue comment preview, **Call** (reveals saved phone or prompts to add → saving persists to Settings → Labs), **Comments** opens modal; a comment added there shows the "Overdue" badge in history.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/today/job-queue-tile.tsx client/src/components/today/call-lab-button.tsx client/src/pages/today.tsx client/src/components/job-comments-panel.tsx client/src/components/job-details-modal.tsx
git commit -m "feat(today): Chase-the-lab queue tile + Call-lab phone flow"
```

---

## Task 10: Starred tile (`starred-tile.tsx`)

**Files:**
- Create: `client/src/components/today/starred-tile.tsx`
- Modify: `client/src/pages/today.tsx` (render in right rail)

**Interfaces:**
- Consumes: `GET /api/jobs/flagged` (existing, office-wide), `getStatusBadgeStyle`, `openJob`.
- Produces: `<StarredTile onOpenJob={(job)=>void} office={…} />`.

- [ ] **Step 1: Implement**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getStatusBadgeStyle } from "@/lib/default-colors";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";

export default function StarredTile({ office, onOpenJob }:
  { office: any; onOpenJob: (job: Job, tab: JobDetailsTab) => void }) {
  const { data: starred = [] } = useQuery<any[]>({ queryKey: ["/api/jobs/flagged"] });
  const customStatuses = office?.settings?.customStatuses ?? [];
  return (
    <section className="flex-none rounded-xl border border-line bg-panel overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-line-2">
        <Star className="h-3.5 w-3.5 text-warn" fill="currentColor" />
        <span className="font-semibold text-sm text-ink">Remember — starred</span>
        <span className="ml-auto font-mono text-[10px] px-1.5 rounded-full bg-paper-2 text-ink-mute">{starred.length}</span>
      </header>
      <ScrollArea className="max-h-64">
        {starred.length === 0 && <div className="p-5 text-center text-sm text-ink-mute">No starred jobs.</div>}
        {starred.map((job) => {
          const st = getStatusBadgeStyle(job.status, customStatuses);
          const statusLabel = customStatuses.find((s: any) => s.id === job.status)?.label ?? job.status;
          return (
            <button key={job.id} className="w-full text-left flex items-start gap-2.5 px-4 py-3 border-b border-line-2 last:border-0 hover:bg-panel-2"
              onClick={() => onOpenJob(job as Job, "overview")} data-testid={`starred-${job.id}`}>
              <Star className="h-3 w-3 mt-1 text-warn flex-none" fill="currentColor" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs text-ink">{job.patientFirstName} {job.patientLastName} · {job.jobType}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: st.background, color: st.text }}>{statusLabel}</span>
                </div>
                {job.importantNote && <div className="text-[11px] text-ink-mute mt-0.5 truncate">{job.importantNote}</div>}
              </div>
            </button>
          );
        })}
      </ScrollArea>
    </section>
  );
}
```

- [ ] **Step 2: Render in `today.tsx`** right rail: `<StarredTile office={office} onOpenJob={openJob} />`.

- [ ] **Step 3: Verify** — all starred jobs (any user) appear with current status badge; click opens the modal.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/today/starred-tile.tsx client/src/pages/today.tsx
git commit -m "feat(today): Starred (Remember) rail with current status"
```

---

## Task 11: Activity tile — "Since last login" (`activity-tile.tsx`)

**Files:**
- Create: `client/src/components/today/activity-tile.tsx`
- Modify: `client/src/pages/today.tsx` (render in right rail)

**Interfaces:**
- Consumes: `GET /api/today/activity` (Task 3), `ActivityType`, `formatDistanceToNow`, `openJob`, `onEdit`.
- Produces: `<ActivityTile filter={ActivityType[]} jobsById={Map} onOpenJob={…} onEdit={…} />`.

- [ ] **Step 1: Implement**

```tsx
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ActivityType, ActivityFeedItem } from "@shared/today-defaults";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";

// One component, two uses: scope="me" (Since last login, with Edit) and
// scope="office" (Team activity, no Edit) — see Task 12.
export default function ActivityTile({ filter, jobsById, onOpenJob, onEdit, scope = "me", title = "Since last login" }:
  { filter: ActivityType[]; jobsById: Map<string, Job>; onOpenJob: (job: Job, tab: JobDetailsTab) => void;
    onEdit?: () => void; scope?: "me" | "office"; title?: string }) {
  const types = filter.join(",");
  const { data } = useQuery<{ since: number; items: ActivityFeedItem[] }>({
    queryKey: ["/api/today/activity", scope, types],
    queryFn: async () => {
      const res = await fetch(`/api/today/activity?scope=${scope}&types=${encodeURIComponent(types)}`, { credentials: "include" });
      return res.ok ? res.json() : { since: Date.now(), items: [] };
    },
  });
  const items = data?.items ?? [];
  return (
    <section className="flex-1 min-h-0 rounded-xl border border-line bg-panel overflow-hidden flex flex-col">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-line-2">
        <MessageSquare className="h-3.5 w-3.5 text-accent" />
        <span className="font-semibold text-sm text-ink">{title}</span>
        {scope === "me" && data?.since ? <span className="ml-auto text-[10px] font-mono text-ink-mute">{formatDistanceToNow(new Date(data.since), { addSuffix: true })}</span> : null}
        {onEdit && <button className="ml-2 text-xs text-ink-mute hover:text-ink" onClick={onEdit} data-testid="activity-edit">Edit</button>}
      </header>
      <ScrollArea className="flex-1 min-h-0">
        {items.length === 0 && <div className="p-5 text-center text-sm text-ink-mute">Nothing new since you were last here.</div>}
        {items.map((it) => {
          const job = jobsById.get(it.jobId);
          return (
            <button key={it.id} className="w-full text-left flex gap-3 px-4 py-3 border-b border-line-2 last:border-0 hover:bg-panel-2"
              onClick={() => job && onOpenJob(job, it.type === "comment" ? "comments" : "overview")} data-testid={`activity-${it.id}`}>
              <span className="w-7 h-7 rounded-full bg-paper-2 text-ink-2 text-[11px] font-semibold grid place-items-center flex-none">
                {it.actor ? `${it.actor.firstName[0] ?? ""}${it.actor.lastName[0] ?? ""}` : "·"}
              </span>
              <div className="min-w-0">
                <div className="text-xs text-ink-2">
                  {it.actor ? <strong className="text-ink">{it.actor.firstName}</strong> : <strong className="text-ink">A job</strong>} {it.verb} <strong className="text-ink">{it.jobLabel}</strong>
                </div>
                {it.detail && <div className="text-[11px] text-ink-mute mt-1 px-2 py-1 rounded bg-paper-2">{it.detail}</div>}
                <div className="text-[10px] font-mono text-ink-faint mt-1">{formatDistanceToNow(new Date(it.at), { addSuffix: true })}</div>
              </div>
            </button>
          );
        })}
      </ScrollArea>
    </section>
  );
}
```

- [ ] **Step 2: Render in `today.tsx`** — `jobsById` and `openActivityEdit` already exist from the Task 7 scaffold. Render `<ActivityTile filter={config.activityFilter} jobsById={jobsById} onOpenJob={openJob} onEdit={openActivityEdit} />` in the right rail (default `scope="me"`, title "Since last login").

- [ ] **Step 3: Verify** — feed shows comments/overdue/stars-notes since last sign-out; the header shows the boundary; clicking a comment item opens the modal on Comments. (To test the boundary: log out and back in; confirm the feed window resets.)

- [ ] **Step 4: Commit**

```bash
git add client/src/components/today/activity-tile.tsx client/src/pages/today.tsx
git commit -m "feat(today): Since-last-login activity feed"
```

---

## Task 12: Owner/manager tiles (`stats-tile`, `analytics-tile`; team reuses `ActivityTile`)

**Files:**
- Create: `client/src/components/today/stats-tile.tsx`, `analytics-tile.tsx`
- Modify: `client/src/pages/today.tsx` (render non-queue slot types)

**Interfaces:**
- Consumes: `/api/jobs`, `/api/jobs/overdue`, `/api/jobs/flagged` (stats); `ActivityTile` with `scope="office"` (team — no new component); `useLocation` from wouter (analytics link).
- Produces: `StatsTile`, `AnalyticsTile`. **No `team-activity-tile.tsx`** — Team activity is `ActivityTile` reused with `scope="office"` (DRY).

- [ ] **Step 1: `stats-tile.tsx`** — a single card showing all key stats (counts already available client-side):

```tsx
import { useQuery } from "@tanstack/react-query";
import type { Job } from "@shared/schema";

export default function StatsTile({ jobs }: { jobs: Job[] }) {
  const { data: overdue = [] } = useQuery<any[]>({ queryKey: ["/api/jobs/overdue"] });
  const { data: starred = [] } = useQuery<any[]>({ queryKey: ["/api/jobs/flagged"] });
  const ready = jobs.filter((j) => j.status === "ready_for_pickup").length;
  const oldest = jobs.reduce((m, j) => Math.max(m, Date.now() - new Date(j.statusChangedAt as any).getTime()), 0);
  const oldestDays = Math.floor(oldest / 86400000);
  const stat = (n: number | string, label: string) => (
    <div className="flex items-baseline gap-2"><span className="font-semibold text-lg text-ink tabular-nums">{n}</span><span className="text-xs text-ink-mute">{label}</span></div>
  );
  return (
    <section className="rounded-xl border border-line bg-panel p-4 grid grid-cols-2 gap-3">
      {stat(ready, "ready to call")}
      {stat(overdue.length, "overdue")}
      {stat(jobs.length, "open backlog")}
      {stat(starred.length, "starred")}
      {stat(`${oldestDays}d`, "oldest job")}
    </section>
  );
}
```

- [ ] **Step 2: `analytics-tile.tsx`** — a deliberately minimal card: the same headline numbers `StatsTile` derives (no bespoke analytics queries) plus a button that jumps to the full Analytics page via `setLocation("/dashboard/analytics")`. This is the lazy version — `// ponytail: reuse stats + link to the full Analytics tab; build bespoke KPIs only if asked`.

```tsx
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import StatsTile from "./stats-tile";
import type { Job } from "@shared/schema";

export default function AnalyticsTile({ jobs }: { jobs: Job[] }) {
  const [, setLocation] = useLocation();
  return (
    <section className="rounded-xl border border-line bg-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm text-ink">Analytics</span>
        <Button size="xs" variant="outline" onClick={() => setLocation("/dashboard/analytics")}>Open Analytics →</Button>
      </div>
      <StatsTile jobs={jobs} />
    </section>
  );
}
```

- [ ] **Step 3: Team activity = reuse `ActivityTile`** — no new file. In `today.tsx`, the `team` slot renders `<ActivityTile scope="office" title="Team activity" filter={["comment","status_change","star_note"]} jobsById={jobsById} onOpenJob={openJob} />` (no `onEdit` → no Edit button; `scope="office"` → 24h office-wide window from Task 3's route).

- [ ] **Step 4: Render non-queue slots in `today.tsx`** — extend the slot map:
```tsx
slot.type === "stats" ? <StatsTile key={i} jobs={jobs} />
: slot.type === "analytics" ? <AnalyticsTile key={i} jobs={jobs} />
: slot.type === "team" ? <ActivityTile key={i} scope="office" title="Team activity"
    filter={["comment", "status_change", "star_note"]} jobsById={jobsById} onOpenJob={openJob} />
: /* queue branches from Tasks 8/9 */
```

- [ ] **Step 5: Verify** (as owner) — set a slot to each of stats/analytics/team (via Task 13 Edit) and confirm each renders; the analytics "Open Analytics →" jumps to the Analytics tab.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/today/stats-tile.tsx client/src/components/today/analytics-tile.tsx client/src/pages/today.tsx
git commit -m "feat(today): owner/manager stats + analytics tiles; team feed reuses ActivityTile"
```

---

## Task 13: Edit popover (`tile-edit-popover.tsx`) + save to preferences

**Files:**
- Create: `client/src/components/today/tile-edit-popover.tsx`
- Modify: `client/src/pages/today.tsx` (wire `openEditFor` / `openActivityEdit` + persistence)

**Interfaces:**
- Consumes: `TodayConfig`, `resolveTodayConfig`, `ACTIVITY_CATALOG`, office `customStatuses`, `PUT /api/user/preferences`.
- Produces: `<TileEditPopover kind="queue"|"activity" slotIndex … config … customStatuses … role … onSave={(next: TodayConfig)=>void} />`.

- [ ] **Step 1: Implement the popover**

```tsx
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ACTIVITY_CATALOG, type TodayConfig, type TileType, type ActivityType } from "@shared/today-defaults";

const TILE_TYPES: { type: TileType; label: string }[] = [
  { type: "queue", label: "Job queue" }, { type: "analytics", label: "Analytics summary" },
  { type: "stats", label: "Stats" }, { type: "team", label: "Team activity" },
];

export default function TileEditPopover({ kind, slotIndex, config, customStatuses, role, trigger, onSave }: {
  kind: "queue" | "activity"; slotIndex?: number; config: TodayConfig;
  customStatuses: { id: string; label: string }[]; role: string; trigger: React.ReactNode;
  onSave: (next: TodayConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TodayConfig>(config);
  const privileged = role === "owner" || role === "manager";

  const save = () => { onSave(draft); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(config); }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-80 space-y-3">
        {kind === "queue" && slotIndex != null && (() => {
          const slot = draft.slots[slotIndex];
          const setSlot = (patch: Partial<typeof slot>) => {
            const slots = [...draft.slots] as TodayConfig["slots"];
            slots[slotIndex] = { ...slots[slotIndex], ...patch };
            setDraft({ ...draft, slots });
          };
          return (
            <>
              {privileged && (
                <div>
                  <label className="text-xs font-medium">Tile type</label>
                  <select className="w-full text-sm border rounded px-2 py-1" value={slot.type}
                    onChange={(e) => setSlot({ type: e.target.value as TileType })}>
                    {TILE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                  </select>
                </div>
              )}
              {slot.type === "queue" && (
                <>
                  <div>
                    <label className="text-xs font-medium">Title</label>
                    <input className="w-full text-sm border rounded px-2 py-1" value={slot.title ?? ""}
                      onChange={(e) => setSlot({ title: e.target.value })} data-testid="edit-title" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Statuses</label>
                    <div className="max-h-40 overflow-auto space-y-1 mt-1">
                      {customStatuses.map((s) => {
                        const on = (slot.statusIds ?? []).includes(s.id);
                        return (
                          <label key={s.id} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={on} data-testid={`edit-status-${s.id}`}
                              onChange={(e) => setSlot({ statusIds: e.target.checked
                                ? [...(slot.statusIds ?? []), s.id]
                                : (slot.statusIds ?? []).filter((id) => id !== s.id) })} />
                            {s.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          );
        })()}

        {kind === "activity" && (
          <div>
            <label className="text-xs font-medium">Show in this feed</label>
            <div className="space-y-1 mt-1">
              {ACTIVITY_CATALOG.map((a) => {
                const on = draft.activityFilter.includes(a.type);
                return (
                  <label key={a.type} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={on} data-testid={`edit-activity-${a.type}`}
                      onChange={(e) => setDraft({ ...draft, activityFilter: e.target.checked
                        ? [...draft.activityFilter, a.type as ActivityType]
                        : draft.activityFilter.filter((t) => t !== a.type) })} />
                    {a.label}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="xs" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="xs" onClick={save} data-testid="edit-save">Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Persist in `today.tsx`** — add a save mutation and wire the tiles' Edit triggers to `TileEditPopover`:

```tsx
const qc = useQueryClient();
const savePrefs = useMutation({
  mutationFn: async (todayConfig: TodayConfig) => {
    await apiRequest("PUT", "/api/user/preferences", { todayConfig }); // whole object — shallow merge
  },
  onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/user"] }),
});
const onSaveConfig = (next: TodayConfig) => savePrefs.mutate(next);
```
Pass an `<TileEditPopover kind="queue" slotIndex={i} config={config} customStatuses={customStatuses} role={user?.role ?? "staff"} trigger={<button>Edit</button>} onSave={onSaveConfig} />` as each queue tile's `onEdit` trigger, and `kind="activity"` for the activity tile. After save, `config` re-derives from the refreshed `user.preferences`.

> Note: `PUT /api/user/preferences` shallow-merges top-level keys, so sending `{ todayConfig }` replaces the whole config object — correct here since `onSave` always passes the full `TodayConfig`. Invalidate `/api/user` so `useAuth`'s `user.preferences` refreshes (the page derives `config` from it).

- [ ] **Step 3: Verify** — Edit on Call patients changes title + status set and persists across reload; Edit on the activity feed toggles action types and persists; as owner, the tile-type selector appears and switching to Stats/Analytics/Team swaps the tile; as staff, no tile-type selector.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/today/tile-edit-popover.tsx client/src/pages/today.tsx
git commit -m "feat(today): per-tile Edit popover persisted to user preferences"
```

---

## Task 14: Lab phone in the customization editor (Settings + wizard)

**Files:**
- Modify: `client/src/components/customization/sortable-list-editor.tsx` (`CustomListItem`, `SortableRow`, `AddItemDialog`)

**Interfaces:**
- Produces: optional `phone` on `CustomListItem`; phone input shown only for `type === "destinations"`. Flows to Settings → Labs and `step-destinations` automatically (both already pass `customOrderDestinations` through `SortableListEditor` and persist via the office settings merge).

- [ ] **Step 1: Extend the type** — `sortable-list-editor.tsx:27-33`:

```ts
export type CustomListItem = {
  id: string;
  label: string;
  color: string;
  hsl?: string;
  order: number;
  phone?: string; // labs/destinations only
};
```

- [ ] **Step 2: Phone field in `SortableRow`** — after the label `Input` block (inside the row), render for destinations:

```tsx
{type === "destinations" && (
  <Input
    value={item.phone ?? ""}
    onChange={(e) => onUpdate(item.id, { phone: e.target.value })}
    placeholder="phone"
    className="h-7 px-2 w-36 text-[calc(12px*var(--ui-scale))] border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:bg-paper-2"
    data-testid={`input-phone-${item.id}`}
  />
)}
```

- [ ] **Step 3: Phone in `AddItemDialog`** — add `const [phone, setPhone] = useState("");`, render an input when `type === "destinations"`, and include `phone: phone.trim() || undefined` in the `onAdd({...})` payload.

- [ ] **Step 4: Verify** — Settings → Labs now shows a phone field per lab; saving persists `phone` in `office.settings.customOrderDestinations` (re-open to confirm); the same field appears in the setup wizard's Labs step. The Chase **Call** button (Task 9) reads it.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/customization/sortable-list-editor.tsx
git commit -m "feat(today): optional phone number on labs in settings + setup wizard"
```

---

## Task 15: Default-view setting in User Settings

**Files:**
- Modify: `client/src/components/user-settings-modal.tsx` (`UserPreferences` type, render a selector)

**Interfaces:**
- Consumes: `PUT /api/user/preferences` (existing), `getInitialTab` (Task 6 already reads `preferences.defaultView`).
- Produces: `UserPreferences.defaultView?: "today" | "worklist"`; UI selector saving it.

- [ ] **Step 1: Extend the type** — `user-settings-modal.tsx:12-15`:

```ts
interface UserPreferences {
  fontSize?: "xs" | "sm" | "default" | "lg" | "xl";
  darkMode?: boolean;
  defaultView?: "today" | "worklist";
  // todayConfig is also stored here but managed on the Today page, not in this modal.
}
```

- [ ] **Step 2: Render a selector** — below the Dark Mode block (after line 149):

```tsx
{/* Default view */}
<div className="flex items-center justify-between">
  <div>
    <Label className="text-sm font-medium">Default view</Label>
    <p className="text-xs text-muted-foreground mt-0.5">Where the app opens after sign-in</p>
  </div>
  <select
    className="text-sm border rounded px-2 py-1"
    value={prefs?.defaultView ?? "today"}
    onChange={(e) => saveMutation.mutate({ defaultView: e.target.value as "today" | "worklist" })}
    data-testid="select-default-view"
  >
    <option value="today">Today</option>
    <option value="worklist">Worklist</option>
  </select>
</div>
```
(`saveMutation` sends `{ defaultView }` — shallow merge keeps the rest of preferences. `getInitialTab` from Task 6 already consumes it.)

- [ ] **Step 3: Verify** — set Default view to Today, fully reload at `/` → lands on the Today tab; set to Worklist → lands on Worklist.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/user-settings-modal.tsx
git commit -m "feat(today): per-user default-view setting (Today vs Worklist)"
```

---

## Task 16: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the test suite**

Run: `npm run test:all`
Expected: PASS, including `test:today-defaults` and `test:today-activity`.

- [ ] **Step 2: Type-check**

Run: `npm run check` (tsc). Expected: no new errors.

- [ ] **Step 3: Manual smoke (run the app)**

As a **staff** user: Today is reachable; Call-patients stamps log comments; Chase shows days + Call/Comments; Starred shows all stars with status; Since-last-login shows the feed and its Edit filters; no tile-type selector. As an **owner**: a slot can be switched to Stats/Analytics/Team. User Settings default-view switches the landing tab. Settings → Labs shows phone.

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A && git commit -m "test(today): full-suite + smoke verification"
```

---

## Self-Review notes (filled during planning + adversarial review)

- **Spec coverage:** §1 Placement → T6/T7; §2 default view → T6+T15; §3 config model → T1; §4 queues → T8/T9; §5 owner tiles → T12; §6 Starred+activity → T10/T11; §7 lab phone → T9(inline)+T14; §8 data/endpoints → T2/T3/T4/T5; §10 Edit → T13; §11 testing → T1/T3 + T16.
- **Type consistency:** all shared types (`TodayConfig`, `SlotConfig`, `ActivityType`, `ActivityFeedItem`) + pure helpers (`resolveTodayConfig`, `selectQueueJobs`, `boundaryFor`, `mergeActivity`) live once in `shared/today-defaults.ts` (T1) and are imported everywhere.
- **Adversarial-review fixes folded in:** column added via the `ensureXxx` bootstrap guard (fresh-install-safe), not a bare migration; `ActivityFeedItem`/`mergeActivity` consolidated into T1; `defaultOverdue` threading spelled out (T9); `jobsById`/`openEditFor`/`openActivityEdit` declared in the T7 scaffold; Team activity reuses `ActivityTile` (`scope="office"`) instead of a duplicate component; status-change verb renders the status *label*; analytics tile kept deliberately minimal (stats + link).
- **Known follow-ups (not blockers):** outreach "last-contact line" shows in-session stamp results only — prior-session contacts are one click away in the Comments tab (upgrade: a batch last-contact lookup like T4 if wanted); `jobStatusHistory` has no `jobId` index — fine at current scale.
