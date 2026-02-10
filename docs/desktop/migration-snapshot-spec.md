# Web → Desktop migration snapshot (spec v1)

This spec defines a **single-file snapshot** that an office can export from the hosted Otto web app and import into the offline desktop Host.

Design goals:
- **Simple**: one file to export/import.
- **Schema-aware**: maps cleanly to the desktop SQLite schema (`shared/schema.ts`).
- **Safe by default**: import is intended for a **fresh Host** (empty database).
- **No licensing secrets**: licensing/activation is handled separately; snapshot contains **data only**.

> Note: The snapshot contains ePHI (patient initials/last name, etc.). Treat it like a backup:
> store it securely and delete it after migration.

---

## File format

- File extension: `.otto-snapshot.json`
- Encoding: UTF-8
- JSON object with top-level keys described below

### Required top-level fields

```json
{
  "format": "otto-snapshot",
  "version": 1,
  "exportedAt": "2026-02-09T00:00:00.000Z",
  "office": { ... },
  "users": [ ... ],
  "jobs": [ ... ],
  "archivedJobs": [ ... ],
  "jobComments": [ ... ],
  "commentReads": [ ... ],
  "jobFlags": [ ... ],
  "jobStatusHistory": [ ... ],
  "notificationRules": [ ... ]
}
```

### Optional top-level fields

- `notifications` (if you want to migrate in-app notification history)
- `phiAccessLogs` (typically *not* migrated; office may want to reset audit log on cutover)
- `adminAuditLogs` (typically not migrated)
- `smsOptIns`, `smsLogs` (desktop does not send SMS, but export can include for archival)
- `jobAnalytics` (optional; can be rebuilt later)

---

## Field conventions

- **IDs**: strings. Import preserves IDs to maintain references.
- **Timestamps**:
  - Prefer **epoch milliseconds** (numbers) for DB fields like `createdAt`, `updatedAt`.
  - ISO timestamps are allowed in export, but desktop import may normalize.
- **JSON columns** (export as JSON objects):
  - `offices.settings`
  - `jobs.customColumnValues`
  - `notificationRules.notifyRoles`, `notificationRules.notifyUsers`
  - `notifications.metadata`
- **Single office**: desktop Host supports one office per install. Snapshot should contain exactly one office.

---

## Entity schemas (mapped to desktop SQLite)

These map to `shared/schema.ts`.

### `office` (table: `offices`)

Required:
- `id` (string)
- `name` (string)
- `enabled` (boolean)
- `settings` (object)
- `createdAt` (number, ms)
- `updatedAt` (number, ms)

Optional:
- `address`, `phone`, `email` (string | null)

### `users` (table: `users`)

Required:
- `id` (string)
- `email` (string, lowercase recommended)
- `password` (string) **hashed** in the same format the desktop app expects (`hex.salt` from scrypt)
- `firstName`, `lastName` (string)
- `role` (`owner` | `manager` | `staff` | `view_only` | `super_admin`)
- `officeId` (string) (must match `office.id`)
- `createdAt`, `updatedAt` (number, ms)

### `jobs` (table: `jobs`)

Required:
- `id` (string)
- `orderId` (string) (unique)
- `patientFirstInitial` (string, 0–1 char depending on office settings)
- `patientLastName` (string)
- `jobType` (string)
- `status` (string)
- `orderDestination` (string)
- `officeId` (string)
- `customColumnValues` (object)
- `isRedoJob` (boolean)
- `createdAt`, `updatedAt`, `statusChangedAt` (number, ms)

Optional:
- `trayNumber`, `phone`, `createdBy`, `originalJobId`, `notes` (string | null)

### `archivedJobs` (table: `archived_jobs`)

Required:
- `id` (string)
- `orderId`, `patientFirstInitial`, `patientLastName`, `jobType`, `finalStatus`, `orderDestination`, `officeId` (strings)
- `customColumnValues` (object)
- `isRedoJob` (boolean)
- `originalCreatedAt`, `archivedAt` (number, ms)

Optional:
- `trayNumber`, `phone`, `createdBy`, `previousStatus`, `originalJobId`, `notes` (string | null)

### `jobComments` (table: `job_comments`)

Required:
- `id` (string)
- `jobId` (string)
- `authorId` (string)
- `content` (string)
- `createdAt` (number, ms)

Optional:
- `isOverdueComment` (boolean)

### `commentReads` (table: `comment_reads`)

Required:
- `id` (string)
- `userId` (string)
- `jobId` (string)
- `lastReadAt` (number, ms)

### `jobFlags` (table: `job_flags`)

Required:
- `id` (string)
- `userId` (string)
- `jobId` (string)
- `createdAt` (number, ms)

Optional:
- `summary` (string | null) — in desktop/offline this is treated as the **Important note**
- `summaryGeneratedAt` (number, ms | null)

### `jobStatusHistory` (table: `job_status_history`)

Required:
- `id` (string)
- `jobId` (string)
- `newStatus` (string)
- `changedBy` (string)
- `changedAt` (number, ms)

Optional:
- `oldStatus` (string | null)

### `notificationRules` (table: `notification_rules`)

Required:
- `id` (string)
- `officeId` (string)
- `status` (string)
- `maxDays` (number)
- `enabled` (boolean)
- `notifyRoles` (string[])
- `notifyUsers` (string[])
- `createdAt` (number, ms)

Optional:
- `smsEnabled` (boolean) (desktop ignores; should export as `false`)
- `smsTemplate` (string | null)

---

## Import rules (desktop Host)

1. Import runs on the **Host** only (Owner role).
2. Import is intended for a **fresh Host** (empty database).
3. IDs are preserved; import should fail fast on:
   - missing required references (e.g., job points to unknown office)
   - duplicate unique keys (e.g., duplicate `orderId`)
4. After import completes:
   - Office settings should be present.
   - Users should be able to sign in with their existing passwords (assuming hashing matches).
   - Starred jobs show “Important note” based on `jobFlags.summary`.

---

## Explicitly out of scope

- Licensing/activation tokens (desktop uses its own Host token via `/license/v1/*`).
- Cross-office snapshots (desktop is single-office).
- Cloud backups (desktop backups are local/network share).

