# Friendly office pilot checklist

This is a short, practical checklist for getting a real office on the desktop app (Host + Clients) safely and smoothly.

## Before you go onsite (you + Otto)

1. **Activation code ready**
   - Create the office in the portal and copy the Activation Code.
2. **Installers built**
   - On a Mac: run `npm run dist:desktop` to generate the `.dmg` in `release/`.
   - On Windows: run `npm run dist:desktop` to generate the `.exe` installer in `release/`.
3. **Do a quick smoke test at home**
   - Install the Host build and complete setup.
   - Install a Client build and connect to the Host.
   - Create + edit a couple jobs, add comments, mark complete.
   - Disconnect the Client from Wi‑Fi for 1 minute, make a change, reconnect, confirm it syncs.
   - Use **File → Back Up Now** on Host and confirm a backup file appears in the backup folder.

## Onsite setup (office)

### A) Choose the Host computer

Keep it simple:
- Pick a computer that stays on all day (front desk is usually best).
- Make sure it’s on the same network as all other office computers.
- Set it to **not sleep** during business hours (sleep disconnects Clients).

### B) Pick the backup folder (network share)

Backups should go to a shared office network folder (not the Host’s local drive), so recovery is possible if the Host is replaced.
- If the office has a server/NAS, create a folder like `OttoBackups` and make sure the Host can write to it.

### C) Install + set up the Host

1. Install Otto Tracker and choose **Host**.
2. Complete the in-app setup:
   - Paste the Activation Code
   - Enter office details
   - Create the first admin login
3. Use **File → Choose Backup Folder…** and select the office network folder.
4. Use **File → Show Host Address…** and save:
   - Host address
   - Pairing code
5. In **Team**, confirm you can see and approve pending account requests.

### D) Install + connect each Client

1. Install Otto Tracker and choose **Client**.
2. Try **Auto-detect Host Computer** first.
3. If needed, paste Host address + Pairing code manually.
4. Click **Connect & Finish** and approve on Host when prompted.
5. Each team member signs in (existing) or clicks **First time here?** to submit an access request.
6. New account requests include first/last name, Login ID, password, and 6-digit PIN.
7. On the Host, owner/manager approves each pending request in **Team**.

Windows note:
- If Windows asks to allow network access for Otto Tracker, choose **Allow** (Private network).

## Post-pilot feedback (what to ask)

- Did setup feel obvious? Where did they hesitate?
- Was “Host address + pairing code” easy to understand?
- Did daily backups get set up successfully?
- Any moments where they expected something to work and it didn’t?
