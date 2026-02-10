# Desktop pilot implementation checklist (actionable)

Goal: get Otto Tracker ready for a **friendly-office pilot** with an **offline Host/Client** model, while keeping the database schema stable enough to support **web → desktop export/import**.

This checklist is ordered by impact and risk. Each section should be complete before moving on.

---

## A) UX + product alignment (highest impact)

### A1 — Make the Worklist the default
- [x] Default landing screen is **Worklist (Active Jobs)**, not “Important”.
- [x] Rename “All Jobs” → **Worklist** everywhere (navigation + headers).
- [ ] Keep “Important/Pinned” as a filter or secondary view, not the home screen.

### A2 — Remove “web-era” flows from desktop builds
- [x] Remove/hide `/office-setup` (create/join office) for desktop.
- [x] Remove/hide invitation email flows (`/accept-invite/:token`) for desktop pilot.
- [x] Remove/hide super admin portal (`/admin`) for desktop builds.

### A3 — Repurpose internet-dependent features for offline
- [x] Remove “AI Summary” language:
  - Replace with **Important note** (staff-entered, stored locally).
  - Do not auto-generate notes in the background.
- [x] SMS:
  - Remove UI for “sending SMS”.
  - Optionally keep **message templates** as “Copy to clipboard” helpers.

### A4 — Notifications that make sense on a LAN app
- [x] Re-enable in-app notifications UI (no internet).
- [ ] Events supported for pilot:
  - New comment
  - Status change
  - Overdue alert
- [ ] Optional later: OS notifications per user/device.

### A5 — Persistent status strip (reduce confusion/support)
- [x] Always visible: Host/Client + connected/disconnected.
- [x] Show pending offline sync count when applicable.
- [x] Show license state when not ACTIVE (grace/read-only).
- [x] Show backup configured/not configured.

---

## B) Reliability + recovery (must-have for pilot trust)

### B1 — Backups
- [x] Daily backups on Host to office network folder.
- [ ] If backups aren’t configured, show a persistent banner until configured.
- [x] “Back up now” and “Restore…” exist in a menu.

### B2 — Replace Host recovery guide
- [ ] Simple, in-app instructions for:
  - Installing on a new Host
  - Restoring from backup
  - Re-activating (portal “Replace Host” if needed)

### B3 — Client offline outbox
- [x] Clear wording: “Working offline, will sync when connected”.
- [ ] Conflict policy documented (pilot: “Host wins; user is informed”).

---

## C) Web → Desktop migration compatibility (schema-aware)

We want migration to be a **one-time** office-owned operation:
1) export a snapshot from the hosted web app
2) import into the Host desktop app
3) office validates
4) office deletes web data (or we purge after confirmation)

### C1 — Define the migration data set (what must move)
- [ ] Office: name/address/phone/email + office `settings` JSON
- [ ] Users (minimum): owners/managers/staff with email, name, role
- [ ] Jobs (active) + Archived jobs
- [ ] Job comments + unread markers (optional)
- [ ] Important flags + important notes (map AI summary → important note if present)
- [ ] Status history (optional but recommended)
- [ ] Audit logs (optional; likely keep only on the web side)
- [ ] Exclude or optional: SMS logs/opt-ins (offline app won’t send SMS)

### C2 — Freeze desktop schema changes that would break import
- [ ] Avoid dropping tables/columns used by the web app export, even if features are hidden in the desktop UI.
- [ ] If fields are deprecated (SMS/AI), keep them in schema but ignore in UI.

### C3 — Implement import/export tooling (separate phase, but planned now)
- [x] Export format spec (JSON + file attachments if needed) documented.
- [x] “Import from web snapshot” flow in desktop Host (Owner only).
- [x] Validate + preview before writing.
- [ ] Idempotency: safe to retry import (no duplicates).
- [ ] Logging: record import events in local audit log (no PHI leaked to internet).

---

## D) Pilot readiness checklist (before shipping to offices)
- [ ] Installer builds for macOS (arm64 + x64 if needed) and Windows.
- [ ] Code signing + notarization plan (macOS) / signing (Windows) drafted (can be “friendly pilot unsigned” if they’re comfortable).
- [ ] Basic support doc: “How to pick the Host”, “How to add Clients”, “How to restore from backup”.
- [ ] Diagnostics screen includes: paths, host address, license, backup status, logs.
