import { app } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;

// update-token.js is generated at build time by the release scripts.
// It contains a read-only GitHub PAT for fetching releases from the private
// repo.  The file is gitignored and only exists in packaged builds.
// In dev mode (unpackaged), we don't need it because auto-update is skipped.
let UPDATE_TOKEN = "";
try {
  ({ UPDATE_TOKEN } = await import("./update-token.js"));
} catch {
  // File doesn't exist in dev — that's fine, auto-update is skipped anyway.
}

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

let intervalId = null;

/**
 * Initialize silent auto-updates.
 *
 * DEVELOPMENT SAFETY: Auto-update is completely disabled when the app is not
 * packaged (i.e. running via `electron .` or the `npm run desktop` dev
 * command).  electron-updater will throw if it tries to update an unpackaged
 * app, and there is no valid build to compare versions against, so we bail
 * early.
 *
 * SECURITY NOTE (F-10): Windows builds are NOT code-signed yet.
 * electron-updater does NOT verify code signatures on Windows by default.
 * Until Windows code signing is implemented (EV certificate):
 *   - A MITM on the update channel could deliver a trojanized update
 *   - Mitigation: updates are fetched over HTTPS from a pinned GitHub repo
 *   - TODO: Implement Windows EV code signing and set
 *     verifyUpdateCodeSignature: true in electron-builder config
 */
export function initAutoUpdater() {
  // Guard: never run in development / unpackaged mode.
  if (!app.isPackaged) {
    console.log("[auto-updater] Skipped — app is not packaged (dev mode).");
    return;
  }

  // Respect OTTO_AUTO_UPDATE env var.  Defaults to enabled, but admins can
  // set OTTO_AUTO_UPDATE=false to disable (e.g. in airgapped environments
  // where any outbound connection is prohibited).
  if (process.env.OTTO_AUTO_UPDATE === "false") {
    console.log("[auto-updater] Disabled via OTTO_AUTO_UPDATE=false.");
    return;
  }

  // For private GitHub repos, electron-updater reads GH_TOKEN from the
  // runtime environment (see providerFactory.js).  Inject it here so the
  // PrivateGitHubProvider is used instead of the unauthenticated one.
  if (UPDATE_TOKEN && !process.env.GH_TOKEN) {
    process.env.GH_TOKEN = UPDATE_TOKEN;
  }

  // Silent operation: download updates in the background, install on quit.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // --- Lifecycle logging (captured by Sentry in production) ---

  autoUpdater.on("checking-for-update", () => {
    console.log("[auto-updater] Checking for update…");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[auto-updater] Update available: v${info.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[auto-updater] App is up to date.");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(
      `[auto-updater] Downloading: ${Math.round(progress.percent)}%`,
    );
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(
      `[auto-updater] Update downloaded: v${info.version}. Will install on next restart.`,
    );
  });

  autoUpdater.on("error", (err) => {
    // Fail silently — log it but never show a dialog or interrupt the user.
    console.error("[auto-updater] Error:", err?.message || err);
  });

  // --- Initial check + periodic schedule ---

  checkForUpdatesSilently();

  intervalId = setInterval(checkForUpdatesSilently, UPDATE_CHECK_INTERVAL_MS);
}

/**
 * Stop the periodic update check timer (e.g. on app quit).
 */
export function stopAutoUpdater() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * Fire-and-forget update check.  Any errors are caught and logged above via
 * the "error" event so they never surface to the user.
 */
function checkForUpdatesSilently() {
  autoUpdater.checkForUpdates().catch(() => {
    // Error is already handled by the "error" event listener above.
  });
}
