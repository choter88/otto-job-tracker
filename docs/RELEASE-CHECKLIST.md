# Release checklist (desktop)

A renderer crash or a dead license check-in both pass `tsc` and the build — so they
can only be caught by lint + actually launching the app. Run these before publishing
a GitHub release that offices auto-update into.

## Pre-release checks (run these manually before publishing)
These are **not** run by `npm run build` (which only does `vite build`, `build:tablet`,
and the esbuild server bundle). There is no `prebuild` hook, so nothing here gates the
build automatically — you must run them yourself and treat a failure as a release blocker.
- **`npm run lint`** — `eslint client` with `react-hooks/rules-of-hooks: error`. Catches
  hooks-after-early-return (the v1.7.16 "React #310" crash class) that `tsc` cannot.
- **`npm run check`** — `tsc` typecheck.
- **`npm run test:all`** — unit/integration suite.

## Manual smoke test (do NOT skip — 60 seconds)
Install the *packaged* build (not `npm run dev`) and:
1. **Launch** — main window opens, no white screen / no error overlay.
2. **Log in** — both **PIN** and **password**. Confirm the dashboard renders (this is
   exactly where #310 crashed). Confirm you can open a job and make an edit.
3. **Check-in lands** — within ~30s, confirm a `POST /license/v1/checkin 200` in the
   portal logs and a fresh check-in time on `/super-admin`. (If it doesn't, the desktop
   can't reach the portal — see the edge/bot-block notes; the app still works while
   `currentPeriodEnd` is in the future thanks to fail-open, but check-ins must work.)

## If a bad build already shipped
- **Delete/unpublish** the bad GitHub release so no more offices pull it.
- Cut the fixed patch as the new "latest" — the main-process auto-updater keeps running
  even if the renderer crashed, so installs self-heal on their next check/restart.

## Future hardening (not yet wired)
- Automated `launch + login` smoke via Playwright's Electron support (`_electron.launch`),
  run in CI on the packaged artifact. Would make step (1)–(2) above automatic.
