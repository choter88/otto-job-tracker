import { app } from "electron";
import fs from "fs";
import path from "path";
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

/**
 * Clear the electron-updater download cache to recover from corrupted downloads.
 *
 * electron-updater caches downloaded updates in a "pending" directory inside
 * the app's userData path.  If the cached file is corrupted (e.g., code signing
 * changed the binary after the manifest hash was computed), the updater will
 * fail with a "sha512 checksum mismatch" error on every launch — creating
 * a crash loop.
 *
 * Deleting the cache directory forces a fresh download on the next check.
 */
function clearUpdateCache() {
  try {
    // electron-updater stores pending downloads in <userData>/pending
    const cacheDir = path.join(app.getPath("userData"), "pending");
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.log("[auto-updater] Cleared cache directory:", cacheDir);
    }
  } catch (e) {
    console.error("[auto-updater] Failed to clear cache:", e?.message);
  }
}

let intervalId = null;

// --- Update state (readable by the menu) ---

/** @type {{ status: string, version: string|null, error: string|null }} */
let updateState = { status: "idle", version: null, error: null };

/** Callback invoked whenever updateState changes so the menu can refresh. */
let onStateChange = null;

/** Callback invoked once if an update is ready at launch (for auto-install). */
let onReadyAtLaunch = null;
let launchCheckDone = false;

function setState(patch) {
  updateState = { ...updateState, ...patch };
  if (typeof onStateChange === "function") {
    try { onStateChange(updateState); } catch { /* ignore */ }
  }
}

/** Return a snapshot of the current update state. */
export function getUpdateState() {
  return { ...updateState };
}

/**
 * Register a callback that fires whenever the update state changes.
 * Used by main.js to rebuild the menu (enable/disable "Install Update").
 */
export function onUpdateStateChange(cb) {
  onStateChange = cb;
}

/**
 * Register a one-shot callback for launch-time auto-install.
 * If an update is already downloaded (cached from previous session), the
 * initial checkForUpdates() will immediately emit "update-downloaded".
 * This callback fires once with the version so main.js can show an
 * "Updating..." screen and call installUpdate().
 */
export function onUpdateReadyAtLaunch(cb) {
  onReadyAtLaunch = cb;
}

/**
 * Initialize auto-updates with background download but NO auto-install.
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

  // Download updates in the background, but do NOT auto-install on quit.
  // Users install explicitly via Help → "Download & Install Update".
  // This prevents the Windows NSIS race condition (sessions not cleaned up)
  // and the Mac blank-screen issue (server not matching new version).
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  // --- Lifecycle logging + state tracking ---

  autoUpdater.on("checking-for-update", () => {
    console.log("[auto-updater] Checking for update…");
    setState({ status: "checking", error: null });
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[auto-updater] Update available: v${info.version}`);
    setState({ status: "downloading", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[auto-updater] App is up to date.");
    setState({ status: "up-to-date", version: null, error: null });
    launchCheckDone = true; // no cached update — don't auto-install later downloads
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(
      `[auto-updater] Downloading: ${Math.round(progress.percent)}%`,
    );
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(
      `[auto-updater] Update downloaded: v${info.version}. Ready to install.`,
    );
    setState({ status: "ready", version: info.version, error: null });

    // If this is the first check (launch), notify main.js for auto-install.
    if (!launchCheckDone && typeof onReadyAtLaunch === "function") {
      launchCheckDone = true;
      try { onReadyAtLaunch(info.version); } catch { /* ignore */ }
      onReadyAtLaunch = null; // one-shot
    }
  });


  autoUpdater.on("error", (err) => {
    const msg = err?.message || String(err);
    console.error("[auto-updater] Error:", msg);

    // SHA-512 checksum mismatch = corrupted cached download.
    // Clear the electron-updater download cache to break the crash loop.
    // Without this, the app retries the corrupt file on every launch and
    // never reaches the main window.
    if (msg.includes("checksum mismatch")) {
      console.warn("[auto-updater] Clearing corrupted update cache…");
      clearUpdateCache();
    }

    setState({ status: "error", error: msg });

    // Mark launch check as done so the app continues to the main window
    // instead of waiting for an auto-install that will never come.
    launchCheckDone = true;
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

/**
 * Manually trigger an update check and return the result.
 * Used by the Help → "Check for Updates…" menu item.
 */
export async function checkForUpdatesManual() {
  if (!app.isPackaged) {
    return { status: "dev", message: "Updates are disabled in development mode." };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    // After the check, updateState is already updated by event handlers.
    // Return current state for the dialog.
    return { ...updateState };
  } catch (err) {
    return { status: "error", error: err?.message || "Check failed" };
  }
}

/**
 * Quit the app and install the downloaded update.
 * Calls autoUpdater.quitAndInstall() which triggers before-quit (session cleanup)
 * then runs the installer and relaunches the app.
 */
export function installUpdate() {
  // isSilent=false (show installer progress), isForceRunAfter=true (relaunch after install)
  autoUpdater.quitAndInstall(false, true);
}
