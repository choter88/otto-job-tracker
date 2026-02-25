# Office setup guide (non-technical)

## What you need

- All computers must be on the **same office network** (same Wi‑Fi or Ethernet).
- Pick one computer to be the **Host computer (Main computer)** (usually a front desk computer that stays on).
- The Host needs periodic internet access for licensing check-ins (no patient data is sent).
- If check-ins are overdue, Otto Tracker keeps retrying and can continue in grace mode for a limited period before switching to **read-only**.
- The Host computer should be set so it **does not go to sleep** during business hours (sleep will disconnect Clients).

## Step 1 — Install on the Host computer

1. Install and open Otto Tracker.
2. When asked, choose **“This computer is the Host”**.
3. On the Host, complete the one-time setup:
   - Enter your **Activation Code** (from the billing portal). Tip: if you used an activation link, the code may auto-fill.
   - Enter your **office details**
   - Create the first **Admin login** (this is local to your office — it does not need to match the billing portal login)
4. After setup completes, sign in and open **Team** to review pending account requests.
   - Team members can request access directly from the sign-in screen.

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
3. Click **Auto-detect Host Computer** (recommended).
4. If auto-detect doesn’t find the Host, click **Enter Host details manually** and enter:
   - **Host address**
   - **Pairing code** (from the Host)
5. Click **Connect & Restart**.
   - Otto checks the connection, requests Host approval, then restarts automatically.
6. Approve the request on the **Host** when prompted.
7. Sign in (existing user) or create a new login:
   - To create a new login, choose **First time here?** and submit an access request.
   - An owner/manager must approve the request on the Host in **Team**.
   - New account setup requires **Login ID**, **password + confirm password**, and a **6-digit PIN + confirm PIN**.

### Windows note (one-time)

If Windows asks whether to allow Otto Tracker on your network, choose **Allow** (Private network).

## Adding team members

1. New user opens the sign-in screen and clicks **First time here?**.
2. New user submits first name, last name, Login ID, password, and 6-digit PIN.
3. On the Host, an Owner/Manager opens **Team** and approves the pending request.
4. After approval, the new user can sign in normally.

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
- If auto-detect does not find the Host, click **Enter Host details manually** and copy both values from **File → Show Host Address…** on the Host.

## If the office network drops briefly

- Otto Tracker will show a banner that it’s disconnected.
- If you make changes while disconnected, Otto Tracker will **save them locally (encrypted)** and **sync automatically** once the connection comes back.

## Host sleep settings (recommended)

The Host should not go to sleep during business hours.

- Mac: `System Settings → Lock Screen → Turn display off on power adapter` (set longer) and disable any “sleep” timer if present.
- Windows: `Settings → System → Power` and set Sleep to `Never` (or a long time) while plugged in.
