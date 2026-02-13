# Offline desktop feature review (Host/Client model)

This document is a **product + UX audit** of the current Otto Tracker app, specifically for the target deployment:

- **Offline / in-office only**
- **One Host (single source of truth)** with **5–10 Clients**
- **SQLite** database on the Host
- **No internet access** except **licensing check-ins** (no PHI sent)
- **HIPAA-oriented controls** (unique logins, auto-logoff, auditability, backups)

It’s written to support decisions like **keep / modify / remove** and to align onboarding and UI with how optometry offices actually work.

---

## Quick summary (what to change first)

1. **Make “Worklist” the home screen** (active jobs) and make “Important” a filter, not a separate primary section.
2. **Remove/repurpose “SMS” and “AI summary”** for offline mode:
   - Replace SMS sending with **“Message templates (copy)”**.
   - Replace AI summary with **“Important note”** (human-entered).
3. **Add a persistent status strip** in the app (Host/Client, connected/disconnected, pending offline changes, backups configured, license state).
4. **Simplify team onboarding**:
   - Keep Staff code (works offline), but consider switching to **one-time “Add user code” per new user** (more secure, less confusion).
5. **Hide platform/admin features** from office users:
   - Remove/hide “Super Admin Portal”, platform analytics, office enable/disable.

---

## Current page map (what users can see today)

Top-level routes:

- `/setup` — Host first-run setup (Activation Code, Office details, first admin login)
- `/auth` — Sign in / Sign up (local accounts; staff code required for sign up)
- `/` and `/dashboard/:tab?` — Main dashboard with tabs:
  - Important
  - All Jobs
  - Past Jobs
  - Overdue
  - Analytics
  - Team
  - Settings (notification rules)
- `/office-setup` — Web-era office create/join flow (likely redundant for desktop)
- `/sms-opt-in` — SMS opt-in web page (not relevant offline)
- `/accept-invite/:token` — Invitation acceptance (web-era)
- `/admin` — Super admin portal (web-era)

Electron “pre-app” flow:

- Host/Client selection + Client connection test (desktop `setup.html`)
- Backup folder chooser (Host)
- Boot/loading screen while Host server starts (desktop `boot.html`)

---

## Feature-by-feature fit (Keep / Modify / Remove)

For each item below:

- **Office user lens** = what a non-technical staff member expects / where they’ll struggle
- **UX lens** = what an expert would change (layout, wording, flow, defaults)

### 1) Host/Client onboarding

**Current**
- Desktop setup asks Host vs Client.
- Client requires Host URL + pairing code + “Test connection”.
- Host later does `/setup` for activation + office + first admin login.

**Recommendation: Modify**
- Keep Host/Client.
- Combine into a single guided wizard (“Step 1 of 4”), with clear “Why this matters”.

**Office user lens**
- “Host” vs “Client” is easy to pick incorrectly unless the app explains it in plain language.
- Users need reassurance: “If you’re not sure, pick Host on the computer that will stay on all day.”

**UX lens**
- Make it decision-based:
  - “Is this the computer that will keep the data for the office?” (Yes → Host, No → Client)
- Add a “What computer should be the Host?” help sheet inside the wizard.
- After setup, show a **tiny persistent badge** (“Host” or “Client”) with a “Change…” link under Diagnostics.

### 2) Activation + licensing (portal → desktop)

**Current**
- Host activation uses an Activation Code; desktop calls the hosted `/license/v1/*` API.
- Grace/read-only behavior is enforced locally by the desktop Host API based on license state.

**Recommendation: Keep + refine UX**

**Office user lens**
- They need a simple sentence: “Activation only checks your subscription; your patient data never leaves your office.”
- If activation fails, they need one next action (not a stack trace).

**UX lens**
- Add an always-visible licensing banner when not ACTIVE:
  - “Activation can’t be verified. X days left until read-only.”
  - Button: “Retry activation” (Host owner only)
  - Link: “Open billing portal” (optional)

### 3) Sign in / sign up (local accounts)

**Current**
- Local email/password accounts, session timeout, staff code for sign up.
- Portal login is separate.

**Recommendation: Keep**

**Office user lens**
- People will assume billing portal login = app login. That confusion is normal.

**UX lens**
- Don’t force them to be the same.
- On Host setup screen, explicitly say:
  - “Billing portal login is for your subscription.”
  - “Otto Tracker login is for staff inside the office.”
  - “You may use the same email address, but passwords are separate.”

### 4) Job tracking (create/edit/status/archive/restore/redo)

**Current**
- All Jobs table + Job dialog for create/edit.
- Status changes; terminal statuses archive.
- Past Jobs view with restore + redo.

**Recommendation: Keep**

**Office user lens**
- This is the core value. It should be the first thing they see.

**UX lens**
- Default “home” should be **Active worklist** (not “Important”).
- Consider a split-pane layout for desktop:
  - Left: list/table
  - Right: job details (status timeline + comments + quick actions)
- Make bulk actions real or remove the buttons (half-working UI erodes trust).

### 5) “Important” jobs

**Current**
- Users can star jobs; “Important Jobs” page shows AI summary block.

**Recommendation: Modify**
- Keep “star/pin”.
- Replace AI summary with a simple “Important note” field (human-entered).

**Office user lens**
- “AI summary” implies internet / data leaving the office, which undermines trust.

**UX lens**
- Make “Important” a filter or saved view inside the worklist.
- If kept as a page, rename to “Pinned / Needs attention”.

### 6) Comments

**Current**
- Comments sidebar per job, unread tracking, counts.

**Recommendation: Keep**

**Office user lens**
- Comments are a natural way to coordinate across front desk / optician / lab.

**UX lens**
- Merge “notes” and “comments” conceptually:
  - “Internal notes” (thread)
  - “Status history” (timeline)
- Add @mentions later if needed (not required for pilot).

### 7) Overdue rules + overdue list

**Current**
- Notification rules define max days per status.
- Overdue page uses severity bands, allows adding a note.

**Recommendation: Keep + clarify naming**

**Office user lens**
- They don’t think in “notification rules”; they think “How long is too long?”

**UX lens**
- Rename “Notification rules” → **Overdue rules** (and later “Reminders”).
- Make “Overdue” visible as:
  - a badge in navigation
  - a banner inside the Worklist

### 8) Notifications (in-app + desktop notifications)

**Current**
- Notifications UI exists but is disabled.
- DB tables + server endpoints exist.

**Recommendation: Modify (re-enable locally)**

**Office user lens**
- Notifications should mean: “Something changed that I care about.”

**UX lens**
- Keep it simple:
  - New comment
  - Status changed
  - Job overdue
- Provide per-user toggles:
  - “Show pop-up notifications on this computer”
  - “Play a sound”

### 9) SMS sending + opt-in

**Current**
- Twilio integration exists; SMS opt-in page exists.

**Recommendation: Remove (sending) / Repurpose (templates)**

**Office user lens**
- If you can’t actually send texts, you shouldn’t show “SMS” toggles.

**UX lens**
- Replace with “Message templates”:
  - Buttons: “Copy ready-for-pickup message”
  - Variables supported as today
- If you later add a texting integration, treat it as a separate paid add-on with explicit consent + BAA considerations.

### 10) Analytics

**Current**
- Charts and counts, date range, job type filters.

**Recommendation: Keep (optional / manager-only)**

**Office user lens**
- Most staff won’t use analytics daily.

**UX lens**
- Put under “Reports” and limit to Owner/Manager.
- Provide 2–3 “answer-based” reports first:
  - “How many jobs are overdue?”
  - “Average days to complete”
  - “By destination”

### 11) Office setup page (create/join office)

**Current**
- Web-era flow where users can create or request to join an office.

**Recommendation: Remove for desktop**

**Office user lens**
- It’s confusing in a single-office desktop app.

**UX lens**
- For desktop: office is created on Host during `/setup`.
- Team membership should be managed through the Host (staff code or one-time codes).

### 12) Invitations + accept-invite

**Current**
- Token-based invites.

**Recommendation: Remove for desktop pilot**

**Office user lens**
- Email-based flows don’t make sense without internet.

**UX lens**
- Replace with “Add team member” inside the app (offline).

### 13) Super admin portal + platform analytics

**Current**
- `/admin` includes platform controls, office enable/disable, activity logs.

**Recommendation: Remove from desktop builds**

**Office user lens**
- Extra screens increase confusion and support burden.

**UX lens**
- Keep this only in the hosted portal (if needed internally), not inside office installs.

### 14) Diagnostics + error logs

**Current**
- Diagnostics exists in the desktop menu; server logs errors to a local file.

**Recommendation: Keep**

**Office user lens**
- “Diagnostics” should give one thing: a way for support to help them quickly.

**UX lens**
- Diagnostics page should include:
  - current mode (Host/Client)
  - host address
  - last backup time + backup folder path
  - license status + last check-in
  - copy button: “Copy support info”

### 15) Backups + host replacement recovery

**Current**
- Host makes daily backups to an office network folder.
- Restore exists.

**Recommendation: Keep + make it impossible to ignore**

**Office user lens**
- Most offices won’t set this up unless prompted clearly (and repeatedly).

**UX lens**
- If backups are not configured:
  - show a persistent banner: “Backups not set up (recommended)”
  - 1-click “Choose backup folder”
- Add a simple “Replace Host” guide:
  - Install Otto on new Host → Restore backup → Activate (portal Replace Host if needed)

### 16) Client offline mode (outbox)

**Current**
- Client queues changes locally when disconnected and flushes when back online.

**Recommendation: Keep + tighten UX**

**Office user lens**
- They need reassurance: “You can keep working. It will sync later.”

**UX lens**
- Use consistent language:
  - “Working offline” (not “won’t save”)
  - “X changes waiting to sync”
- Add a conflict policy statement:
  - “If two people edit the same job while offline, Host wins and we’ll prompt you.”

---

## Proposed navigation (pilot)

Keep the app small for the friendly-office pilot:

- **Worklist** (active jobs) — default
  - filters: Important, Overdue, My jobs (later), Status, Type, Destination
- **History** (past jobs)
- **Team** (add users, roles)
- **Reports** (analytics; owner/manager only)
- **Settings** (office workflow settings; owner/manager only)

Everything else should be removed or hidden for now.
