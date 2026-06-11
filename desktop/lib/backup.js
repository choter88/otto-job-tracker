import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import Database from "better-sqlite3";

// Cadence + retention tuning. Snapshots are single-digit MB for a small
// practice; a tight cadence is essentially free. Retention is tiered so the
// 15-minute cadence doesn't balloon disk usage:
//   - keep every snapshot from the last 24 hours
//   - keep one snapshot per calendar day for the prior 30 days
//   - delete anything older
export const BACKUP_INTERVAL_MS = 1000 * 60 * 15;
const RECENT_RETENTION_MS = 1000 * 60 * 60 * 24;
const ARCHIVE_RETENTION_MS = 1000 * 60 * 60 * 24 * 30;

export function isAllowedNetworkBackupDir(dirPath) {
  if (!dirPath || typeof dirPath !== "string") return false;
  const normalized = path.resolve(dirPath);

  if (process.platform === "darwin") {
    if (!normalized.startsWith("/Volumes/")) return false;
    try {
      const fsType = execFileSync("stat", ["-f", "%T", normalized], { encoding: "utf8" }).trim().toLowerCase();
      const allowed = new Set(["smbfs", "nfs", "afpfs", "webdav", "cifs"]);
      return allowed.has(fsType);
    } catch {
      return false;
    }
  }

  if (process.platform === "win32") {
    if (normalized.startsWith("\\\\")) return true;
    const root = path.parse(normalized).root;
    const drive = root?.slice(0, 2)?.toUpperCase();
    const systemDrive = String(process.env.SystemDrive || "C:").toUpperCase();
    if (!drive || drive.length !== 2) return false;
    if (drive === systemDrive) return false;
    try {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='${drive}'").DriveType`,
        ],
        { encoding: "utf8", windowsHide: true },
      )
        .trim()
        .split(/\s+/)[0];
      return out === "4";
    } catch {
      return false;
    }
  }

  return normalized.startsWith("/mnt/") || normalized.startsWith("/media/");
}

export function networkBackupHelpText() {
  if (process.platform === "darwin") {
    return (
      "Please choose a shared office network folder.\n\n" +
      "Tip (Mac): connect to the office file server in Finder, then select the mounted share under /Volumes.\n" +
      "Example: /Volumes/OfficeShare/OttoBackups"
    );
  }

  if (process.platform === "win32") {
    return (
      "Please choose a shared office network folder.\n\n" +
      "Tip (Windows): select a UNC path like \\\\SERVER\\Share\\OttoBackups, or a mapped network drive like Z:\\OttoBackups."
    );
  }

  return "Please choose a shared office network folder.";
}

export async function chooseNetworkBackupFolder({ dialog, readConfig, writeConfig }) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose Backup Folder (Network)",
    properties: ["openDirectory", "createDirectory"],
    message: "Choose a shared office network folder for daily backups.",
  });

  if (canceled || filePaths.length === 0) return null;
  const dirPath = filePaths[0];

  if (!isAllowedNetworkBackupDir(dirPath)) {
    await dialog.showMessageBox({
      type: "error",
      message: "That doesn't look like a network folder.",
      detail: networkBackupHelpText(),
    });
    return null;
  }

  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const testFile = path.join(dirPath, `.otto-backup-write-test-${Date.now()}.tmp`);
    fs.writeFileSync(testFile, "ok", { mode: 0o600 });
    fs.unlinkSync(testFile);
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      message: "Can't write to that folder.",
      detail:
        "Otto Tracker needs permission to save backups there.\n\n" +
        `Folder:\n${dirPath}\n\n` +
        `Error:\n${error?.message || error}`,
    });
    return null;
  }

  const current = readConfig();
  writeConfig({
    ...current,
    backupDir: dirPath,
    backupEnabled: true,
    backupLastError: "",
  });
  return dirPath;
}

export function formatBackupTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const pad3 = (n) => String(n).padStart(3, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const ms = pad3(date.getMilliseconds());
  // Millisecond suffix avoids collisions during the DST fall-back hour and
  // when a manual run-now lands within the same second as a scheduled tick.
  return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}-${ms}`;
}

export function listBackupFiles(dirPath) {
  try {
    return fs
      .readdirSync(dirPath)
      .filter((name) => name.startsWith("otto-backup-") && (name.endsWith(".sqlite") || name.endsWith(".db")))
      .sort()
      .map((name) => path.join(dirPath, name));
  } catch {
    return [];
  }
}

function parseBackupTimestamp(filename) {
  // The trailing -mmm group is optional so older files (written before the
  // millisecond suffix existed) still parse correctly during retention.
  const match = filename.match(/^otto-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d{3}))?\.(sqlite|db)$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, ms] = match;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms) || 0).getTime();
}

// Order-sheet attachment files live OUTSIDE the SQLite database (on disk
// under <data>/order-sheet-attachments/) so backups don't ship MB per
// sheet inside the .sqlite. Each backup pairs its .sqlite with a sidecar
// directory at <backup-dir>/otto-backup-<ts>-attachments/ that holds a
// copy of every attachment file present at backup time. Restore reads
// the sidecar; retention deletes it alongside the sqlite.
//
// Why a sidecar (not a zip): no new native deps, the directory format
// matches what restore writes back, and SMB/AFP shares handle a folder
// of small PDFs fine — the same shares already hold every other Otto
// artifact today.

const ATTACHMENTS_SUBDIR = "order-sheet-attachments";

/** Derive the sidecar directory path for a given backup file. */
export function getAttachmentSidecarPath(backupFilePath) {
  const dir = path.dirname(backupFilePath);
  const base = path.basename(backupFilePath).replace(/\.(sqlite|db)$/i, "");
  return path.join(dir, `${base}-attachments`);
}

/**
 * Recursively copy a directory's contents to a destination. Best-effort:
 * on a failing individual file we log and keep going so a single locked
 * attachment doesn't kill the rest of the backup. Returns the count of
 * files written.
 */
function copyDirContents(srcDir, destDir) {
  let copied = 0;
  let entries;
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return 0;
    throw err;
  }
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    try {
      if (entry.isDirectory()) {
        copied += copyDirContents(src, dest);
      } else if (entry.isFile()) {
        fs.copyFileSync(src, dest);
        try {
          fs.chmodSync(dest, 0o600);
        } catch {
          // best-effort on filesystems that don't carry POSIX modes
        }
        copied += 1;
      }
    } catch (err) {
      console.error(`[backup] failed to copy ${src}:`, err?.message || err);
    }
  }
  return copied;
}

/**
 * Snapshot the live attachments directory into the sidecar next to the
 * just-written .sqlite. Called AFTER the sqlite backup succeeds so a
 * failed sidecar leaves an obvious orphan (no `.sqlite` to point at) and
 * doesn't lie about the sqlite's status. Returns the file count or 0 if
 * the source directory doesn't exist / is empty.
 */
export function copyAttachmentsForBackup(backupFilePath, sourceDataDir) {
  const sourceDir = path.join(sourceDataDir, ATTACHMENTS_SUBDIR);
  if (!fs.existsSync(sourceDir)) return 0;
  const sidecar = getAttachmentSidecarPath(backupFilePath);
  try {
    if (fs.existsSync(sidecar)) {
      fs.rmSync(sidecar, { recursive: true, force: true });
    }
    return copyDirContents(sourceDir, sidecar);
  } catch (err) {
    console.error("[backup] failed to copy attachments sidecar:", err?.message || err);
    // Leave whatever managed to land — the sqlite is still good, and
    // the next backup will refresh the sidecar.
    return 0;
  }
}

/**
 * Restore the attachments folder from a backup's sidecar. Wipes the
 * live <data>/order-sheet-attachments/ first so the destination matches
 * the backup point-in-time exactly (no straggler files survive a
 * restore). Legacy backups WITHOUT a sidecar are tolerated — restore
 * proceeds with an empty attachments directory and the job dialogs
 * fall back to the "no preview" message.
 */
export function restoreAttachmentsFromBackup(backupFilePath, destDataDir) {
  const sidecar = getAttachmentSidecarPath(backupFilePath);
  const destDir = path.join(destDataDir, ATTACHMENTS_SUBDIR);
  try {
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("[restore] failed to clear attachments dir:", err?.message || err);
  }
  // Always end with an existing (possibly empty) directory so the server
  // and tests see a consistent layout, whether or not a sidecar was
  // available. Legacy .sqlite-only backups land here with 0 files.
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(sidecar)) return 0;
  try {
    return copyDirContents(sidecar, destDir);
  } catch (err) {
    console.error("[restore] failed to copy attachments sidecar:", err?.message || err);
    return 0;
  }
}

/** Remove an attachment sidecar when its paired .sqlite is being pruned. */
export function removeAttachmentSidecar(backupFilePath) {
  const sidecar = getAttachmentSidecarPath(backupFilePath);
  try {
    fs.rmSync(sidecar, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// Sweep .tmp files left behind by a crashed/killed backup. The 1-hour age
// guard keeps us safely clear of any in-progress write.
const ORPHAN_TMP_MAX_AGE_MS = 1000 * 60 * 60;

function cleanupOrphanTempFiles(dirPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith("otto-backup-") || !name.endsWith(".tmp")) continue;
    const tmpPath = path.join(dirPath, name);
    try {
      const stat = fs.statSync(tmpPath);
      if (now - stat.mtimeMs > ORPHAN_TMP_MAX_AGE_MS) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore
    }
  }
}

// Tiered retention: keep all snapshots within the recent window (default 24 h),
// keep one-per-day in the archive window (default 30 d), drop everything older.
// The retentionCount parameter is accepted for backward compatibility but ignored.
export function enforceBackupRetention(dirPath, _retentionCount) {
  const files = listBackupFiles(dirPath);
  cleanupOrphanTempFiles(dirPath);
  if (files.length === 0) return;

  const now = Date.now();
  const latestPerDay = new Map();
  const toDelete = new Set();

  for (const filePath of files) {
    const name = path.basename(filePath);
    const ts = parseBackupTimestamp(name);
    if (ts === null) continue;

    const ageMs = now - ts;
    if (ageMs < RECENT_RETENTION_MS) continue;
    if (ageMs > ARCHIVE_RETENTION_MS) {
      toDelete.add(filePath);
      continue;
    }

    const dayKey = name.slice("otto-backup-".length, "otto-backup-".length + 10);
    const previous = latestPerDay.get(dayKey);
    if (previous) toDelete.add(previous);
    latestPerDay.set(dayKey, filePath);
  }

  for (const filePath of toDelete) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
    // The attachment sidecar lives next to the .sqlite and ages out
    // with it — keeping one without the other would just leak disk.
    removeAttachmentSidecar(filePath);
  }
}

// Prune old backups independently of a backup write. enforceBackupRetention
// otherwise only runs right after a successful backup, so if backups pause
// (Host closed for a while) or are disabled, stale files never get cleaned.
// This sweep — run on startup and on each schedule tick — keeps the 30-day
// window honored for both the local and network backup folders.
export function runBackupRetentionSweep({ readConfig, getLocalBackupDir }) {
  let config;
  try {
    config = readConfig();
  } catch {
    return;
  }
  if (!config || config.mode !== "host") return;

  if (config.localBackupEnabled !== false && typeof getLocalBackupDir === "function") {
    try {
      enforceBackupRetention(getLocalBackupDir());
    } catch {
      // ignore — best-effort cleanup
    }
  }

  if (config.backupDir && isAllowedNetworkBackupDir(config.backupDir)) {
    try {
      if (fs.existsSync(config.backupDir)) enforceBackupRetention(config.backupDir);
    } catch {
      // ignore — network folder may be unmounted
    }
  }
}

export async function runBackupToLocalFolder({ interactive, reason }, { dialog, readConfig, writeConfig, getSqlitePath, getLocalBackupDir }) {
  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    if (interactive) {
      await dialog.showMessageBox({
        type: "error",
        message: "No data to back up yet.",
        detail: "The database file was not found. Create at least one office/user/job first, then try again.",
      });
    }
    return;
  }

  const config = readConfig();
  if (config.mode !== "host") return;
  if (config.localBackupEnabled === false) return;

  const backupDir = getLocalBackupDir();
  try {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    const updated = readConfig();
    writeConfig({ ...updated, localBackupLastError: error?.message || String(error) });
    if (interactive) {
      await dialog.showMessageBox({
        type: "error",
        message: "Local backup failed.",
        detail: `Folder:\n${backupDir}\n\nError:\n${error?.message || error}`,
      });
    }
    return;
  }

  const stamp = formatBackupTimestamp(new Date());
  const finalPath = path.join(backupDir, `otto-backup-${stamp}.sqlite`);
  const tempPath = `${finalPath}.tmp`;

  const db = new Database(sqlitePath, { fileMustExist: true });
  try {
    try {
      await db.backup(tempPath);
      fs.renameSync(tempPath, finalPath);

      // Snapshot the order-sheet attachments alongside the .sqlite so
      // restore brings back the actual PDFs, not just the rows that
      // point at them. Best-effort: a failed sidecar leaves the sqlite
      // valid and the dialog will fall back to "no preview saved".
      copyAttachmentsForBackup(finalPath, path.dirname(sqlitePath));

      const updated = readConfig();
      writeConfig({
        ...updated,
        localBackupLastAt: Date.now(),
        localBackupLastPath: finalPath,
        localBackupLastError: "",
      });

      enforceBackupRetention(backupDir, updated.localBackupRetention);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }

      const updated = readConfig();
      writeConfig({
        ...updated,
        localBackupLastError: error?.message || String(error),
      });

      if (interactive) {
        await dialog.showMessageBox({
          type: "error",
          message: "Local backup failed.",
          detail: `Folder:\n${backupDir}\n\nError:\n${error?.message || error}`,
        });
      }
      return;
    }
  } finally {
    db.close();
  }

  if (interactive) {
    await dialog.showMessageBox({
      type: "info",
      message: "Local backup saved.",
      detail:
        `Saved to:\n${finalPath}\n\n` +
        "This is a local backup on the Host computer. For disaster recovery, set up a shared office network backup folder too.",
    });
  }
}

export async function runBackupToNetworkFolder({ interactive, reason }, { dialog, readConfig, writeConfig, getSqlitePath, chooseNetworkBackupFolder: chooseFolder }) {
  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    if (interactive) {
      await dialog.showMessageBox({
        type: "error",
        message: "No data to back up yet.",
        detail: "The database file was not found. Create at least one office/user/job first, then try again.",
      });
    }
    return;
  }

  const config = readConfig();
  if (config.mode !== "host") return;
  if (config.backupEnabled === false) return;

  let backupDir = config.backupDir;
  if (!backupDir) {
    if (!interactive) return;
    const chosen = await chooseFolder();
    if (!chosen) return;
    backupDir = chosen;
  }

  if (!isAllowedNetworkBackupDir(backupDir)) {
    if (interactive) {
      await dialog.showMessageBox({
        type: "error",
        message: "Backup folder must be a network folder.",
        detail: networkBackupHelpText(),
      });
    }
    writeConfig({ ...config, backupLastError: "Backup folder is not a network folder." });
    return;
  }

  const stamp = formatBackupTimestamp(new Date());
  const finalPath = path.join(backupDir, `otto-backup-${stamp}.sqlite`);
  const tempPath = `${finalPath}.tmp`;

  const db = new Database(sqlitePath, { fileMustExist: true });
  try {
    try {
      await db.backup(tempPath);
      fs.renameSync(tempPath, finalPath);

      // Same attachments sidecar as the local-backup path — without it,
      // recovering from a Host disaster would lose every PDF preview.
      copyAttachmentsForBackup(finalPath, path.dirname(sqlitePath));

      const updated = readConfig();
      writeConfig({
        ...updated,
        backupLastAt: Date.now(),
        backupLastPath: finalPath,
        backupLastError: "",
      });

      enforceBackupRetention(backupDir, updated.backupRetention);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }

      const updated = readConfig();
      writeConfig({
        ...updated,
        backupLastError: error?.message || String(error),
      });

      if (interactive) {
        await dialog.showMessageBox({
          type: "error",
          message: "Backup failed.",
          detail:
            `Folder:\n${backupDir}\n\n` +
            `Error:\n${error?.message || error}\n\n` +
            "Make sure the office network folder is connected and writable, then try again.",
        });
      }
      return;
    }
  } finally {
    db.close();
  }

  if (interactive) {
    await dialog.showMessageBox({
      type: "info",
      message: "Backup saved.",
      detail: `Saved to:\n${finalPath}\n\nThis folder should be a shared office network folder so you can recover if the Host computer is replaced.`,
    });
  }
}

export async function restoreDatabase({ app, dialog, readConfig, getLocalBackupDir }) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Select Backup File",
    properties: ["openFile"],
    filters: [{ name: "SQLite Backup", extensions: ["sqlite", "db"] }],
    defaultPath: (() => {
      const config = readConfig();
      if (config.backupDir) return config.backupDir;
      if (config.localBackupEnabled !== false) return getLocalBackupDir();
      return app.getPath("documents");
    })(),
  });

  if (canceled || filePaths.length === 0) return;
  const backupPath = filePaths[0];

  const confirm = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Restore", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Restore backup?",
    detail: "This will replace the current data on this Host computer. Continue only if you are sure.",
  });

  if (confirm.response !== 0) return;

  app.relaunch({ args: [...process.argv.slice(1), "--restore", backupPath] });
  app.exit(0);
}

export function scheduleAutomaticBackups({ readConfig, runLocalBackup, runNetworkBackup, getLocalBackupDir, getIntervalRef, setIntervalRef }) {
  const current = getIntervalRef();
  if (current) {
    clearInterval(current);
    setIntervalRef(null);
  }

  const config = readConfig();
  if (config.mode !== "host") return;

  // Prune stale backups now (e.g. after the Host was closed for days) so the
  // 30-day window is honored even before/independent of the next backup write.
  runBackupRetentionSweep({ readConfig, getLocalBackupDir });

  const now = Date.now();
  const localEnabled = config.localBackupEnabled !== false;
  const networkEnabled = config.backupEnabled !== false && Boolean(config.backupDir);

  const localLastAt = Number(config.localBackupLastAt) || 0;
  const networkLastAt = Number(config.backupLastAt) || 0;

  const dueLocal = localEnabled && now - localLastAt > BACKUP_INTERVAL_MS;
  const dueNetwork = networkEnabled && now - networkLastAt > BACKUP_INTERVAL_MS;

  if (dueLocal) {
    setTimeout(() => {
      runLocalBackup({ interactive: false, reason: "startup" }).catch(() => {});
    }, 30_000);
  }

  if (dueNetwork) {
    setTimeout(() => {
      runNetworkBackup({ interactive: false, reason: "startup" }).catch(() => {});
    }, 30_000);
  }

  if (!localEnabled && !networkEnabled) return;

  setIntervalRef(setInterval(() => {
    runLocalBackup({ interactive: false, reason: "scheduled" }).catch(() => {});
    runNetworkBackup({ interactive: false, reason: "scheduled" }).catch(() => {});
    // Sweep again on each tick so disabled/paused folders still get pruned.
    runBackupRetentionSweep({ readConfig, getLocalBackupDir });
  }, BACKUP_INTERVAL_MS));
}

export async function maybePromptForBackupFolder({ dialog, readConfig, chooseNetworkBackupFolder: chooseFolder, scheduleAutomaticBackups: scheduleBackups }) {
  const config = readConfig();
  if (config.mode !== "host") return;
  if (config.backupEnabled === false) return;
  if (config.backupDir) return;

  const result = await dialog.showMessageBox({
    type: "info",
    buttons: ["Choose Backup Folder\u2026", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    message: "Set up daily backups (recommended)",
    detail:
      "Otto Tracker can automatically save a daily backup to a shared office network folder.\n\n" +
      "Local backups run automatically on this Host, but a shared network backup helps you recover if the Host computer is replaced.\n\n" +
      "Choose a network folder now?",
  });

  if (result.response !== 0) return;
  const chosen = await chooseFolder();
  if (chosen) scheduleBackups();
}

export async function maybeWarnAboutBackups({ dialog, readConfig, getLocalBackupDir, runNetworkBackup, runLocalBackup, chooseNetworkBackupFolder: chooseFolder, scheduleAutomaticBackups: scheduleBackups, getBackupWarningShown, setBackupWarningShown }) {
  if (getBackupWarningShown()) return;
  const config = readConfig();
  if (config.mode !== "host") return;

  const now = Date.now();
  const localHasError = config.localBackupEnabled !== false && Boolean(config.localBackupLastError);

  const networkHasFolder = Boolean(config.backupDir);
  const networkEnabled = config.backupEnabled !== false;
  const networkLastAt = Number(config.backupLastAt) || 0;
  const networkTooOld = networkHasFolder && (!networkLastAt || now - networkLastAt > 1000 * 60 * 60 * 24 * 2);
  const networkHasError = networkHasFolder && Boolean(config.backupLastError);

  const networkNeedsAttention = networkEnabled && networkHasFolder && (networkTooOld || networkHasError);
  const localNeedsAttention = localHasError;

  if (!networkNeedsAttention && !localNeedsAttention) return;
  setBackupWarningShown(true);

  const detailParts = [];
  if (networkNeedsAttention) {
    detailParts.push("Network backups");
    if (networkLastAt) {
      detailParts.push(`Last backup: ${new Date(networkLastAt).toLocaleString()}`);
    } else {
      detailParts.push("Last backup: never");
    }
    if (config.backupLastPath) {
      detailParts.push(`Last backup file:\n${config.backupLastPath}`);
    }
    if (networkHasError) {
      detailParts.push(`Last error:\n${config.backupLastError}`);
    }
  }

  if (localNeedsAttention) {
    if (detailParts.length) detailParts.push("");
    detailParts.push("Local backups");
    detailParts.push(`Folder:\n${getLocalBackupDir()}`);
    detailParts.push(`Last error:\n${config.localBackupLastError}`);
  }

  const actions = [];
  if (networkNeedsAttention) {
    actions.push({ label: "Back Up Now", run: () => runNetworkBackup({ interactive: true, reason: "manual" }) });
    actions.push({
      label: "Choose Backup Folder\u2026",
      run: async () => {
        const chosen = await chooseFolder();
        if (chosen) scheduleBackups();
      },
    });
  }
  if (localNeedsAttention) {
    actions.push({ label: "Retry Local Backup", run: () => runLocalBackup({ interactive: true, reason: "manual" }) });
  }
  actions.push({ label: "OK", run: null });

  const result = await dialog.showMessageBox({
    type: "warning",
    buttons: actions.map((a) => a.label),
    defaultId: 0,
    cancelId: actions.length - 1,
    message: "Backups need attention",
    detail:
      detailParts.join("\n\n") +
      "\n\nDaily backups help you recover if the Host computer is replaced.",
  });

  const picked = actions[result.response];
  if (picked?.run) {
    await picked.run();
  }
}
