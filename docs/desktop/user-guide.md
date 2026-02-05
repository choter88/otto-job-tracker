# Office setup guide (non-technical)

## What you need

- All computers must be on the **same office network** (same Wi‑Fi or Ethernet).
- Pick one computer to be the **Host (SOT)** (usually a front desk computer that stays on).

## Step 1 — Install on the Host (SOT)

1. Install and open Otto Tracker.
2. When asked, choose **“This computer is the Host”**.
3. Sign in and set up your office/users.

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
5. Click **Save & Restart**.

## Backups (recommended weekly)

On the Host computer:
- Open **File → Backup Data…**
- Save the backup file to a safe place (for example a USB drive).

## Restore (only on the Host)

On the Host computer:
- Open **File → Restore Data…**
- Select a backup file to restore.

This replaces the Host’s current data with the backup.

## If a Client can’t connect

- Confirm the Host computer is on and Otto Tracker is open.
- Confirm both computers are on the same Wi‑Fi/network.
- Try a different Host address from **Show Host Address…**
- Re-check the **Pairing code** (Client setup screen) matches the Host.
