# Office setup guide (non-technical)

## What you need

- All computers must be on the **same office network** (same Wi‑Fi or Ethernet).
- Pick one computer to be the **Host (SOT)** (usually a front desk computer that stays on).
- The **Host needs internet access at least once every 7 days** to verify the office is active (no patient data is sent). If it can’t verify, Otto Tracker switches to **read-only** until it can.
- The Host computer should be set so it **does not go to sleep** during business hours (sleep will disconnect Clients).

## Step 1 — Install on the Host (SOT)

1. Install and open Otto Tracker.
2. When asked, choose **“This computer is the Host”**.
3. On the Host, complete the one-time setup:
   - Paste your **Activation Code** (from the billing portal)
   - Enter your **office details**
   - Create the first **Admin login** (this is local to your office — it does not need to match the billing portal login)
4. Otto Tracker will show a **Staff code**. Save it — your team will need it to create their logins.

## Step 2 — Find the Host address

On the Host computer:
- Open the menu: **File → Show Host Address…**
- You’ll see 1–2 addresses (examples):
  - `https://192.168.1.10:5150`
  - `https://10.0.0.5:5150`
- You’ll also see a **Pairing code** (example `A1B2-C3D4-E5F6`)

You’ll use one of those on each Client computer.

## Step 3 — Install on each Client computer

1. Install and open Otto Tracker.
2. Choose **“This computer is a Client”**.
3. Paste the **Host address** into the box.
4. Enter the **Pairing code** (from the Host).
5. Click **Test Connection**.
6. If it says **Connection successful**, click **Save & Restart**.
7. Sign in (existing user) or create a new login:
   - To create a new login, the user needs the **Staff code** from the office owner/admin.

### Windows note (one-time)

If Windows asks whether to allow Otto Tracker on your network, choose **Allow** (Private network).

## Adding team members

On the Host, sign in as the **Owner** and open **Team**:
- Click **Generate Staff code**
- Give that code to the new team member

The Staff code can be regenerated at any time (this replaces the old code).

## Backups (automatic daily — recommended)

On the Host computer (one-time setup):
- Open **File → Choose Backup Folder…**
- Select a **shared office network folder** (for example a folder on your office server/NAS).

After that:
- Otto Tracker saves a **daily backup automatically** (as long as the Host computer is on).
- You can also run an extra backup anytime: **File → Back Up Now**

## Restore (only on the Host)

On the Host computer:
- Open **File → Restore Data…**
- Select a backup file to restore.

This replaces the Host’s current data with the backup.

## If the Host computer is replaced (recovery)

1. Install Otto Tracker on the replacement computer.
2. In the setup screen, choose **Host**.
3. Open **File → Restore Data…**
4. Select the most recent backup from your office network backup folder.
5. On each Client computer, open **File → Change Connection…** and reconnect to the new Host address (and re-enter the Pairing code).

## If a Client can’t connect

- Confirm the Host computer is on and Otto Tracker is open.
- Confirm both computers are on the same Wi‑Fi/network.
- Try a different Host address from **Show Host Address…**
- Re-check the **Pairing code** (Client setup screen) matches the Host.

## If the office network drops briefly

- Otto Tracker will show a banner that it’s disconnected.
- If you make changes while disconnected, Otto Tracker will **save them locally (encrypted)** and **sync automatically** once the connection comes back.

## Host sleep settings (recommended)

The Host should not go to sleep during business hours.

- Mac: `System Settings → Lock Screen → Turn display off on power adapter` (set longer) and disable any “sleep” timer if present.
- Windows: `Settings → System → Power` and set Sleep to `Never` (or a long time) while plugged in.
