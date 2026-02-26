# Desktop development notes

## Host computer dev

1. Install the app’s dependencies (one-time per computer):
   - `npm install`
2. Start the app server:
   - `cp .env.example .env`
   - `npm run dev`
3. In a second terminal, start Electron:
   - `npm run desktop`

On first launch, choose **Host** in the setup screen.
Then complete the one-time in-app setup (`/setup`) to create the office + first admin login.

Host setup claims are posted to the portal in this order:
1. `/api/desktop/claims/consume` (canonical)
2. `/portal/api/desktop/claims/consume` (alias)
3. `/license/v1/claim-host` (legacy fallback)

You can override the consume path with `OTTO_PORTAL_CLAIM_CONSUME_PATH` if needed.

If you see `tsx: command not found` or `electron: command not found`, it means step 1 didn’t run (or didn’t finish).

## Client dev

1. Ensure the Host is running on a LAN-accessible IP (set `OTTO_LISTEN_HOST=0.0.0.0`).
2. Start Electron on another machine:
   - `npm run desktop`
3. Choose **Client** and connect to the Host (auto-detect first, then manual Host details if needed).
   - In dev, the Host runs over HTTP and does not require a pairing code.
   - In the packaged desktop app, the Host runs over HTTPS and Clients will need the pairing code shown by **File → Show Host Address…**.
   - Click **Connect & Finish** to run connection test + Host approval in one flow.

## Building installers (macOS/Windows)

- `npm run dist:desktop`

Outputs installers into `release/`.
