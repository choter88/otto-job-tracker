import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import Database from "better-sqlite3";

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
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
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

export function enforceBackupRetention(dirPath, retentionCount) {
  const keep = Math.max(1, Number(retentionCount) || 14);
  const files = listBackupFiles(dirPath);
  if (files.length <= keep) return;

  const toDelete = files.slice(0, Math.max(0, files.length - keep));
  for (const filePath of toDelete) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
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

export function scheduleAutomaticBackups({ readConfig, runLocalBackup, runNetworkBackup, getIntervalRef, setIntervalRef }) {
  const current = getIntervalRef();
  if (current) {
    clearInterval(current);
    setIntervalRef(null);
  }

  const config = readConfig();
  if (config.mode !== "host") return;

  const ONE_DAY_MS = 1000 * 60 * 60 * 24;
  const now = Date.now();
  const localEnabled = config.localBackupEnabled !== false;
  const networkEnabled = config.backupEnabled !== false && Boolean(config.backupDir);

  const localLastAt = Number(config.localBackupLastAt) || 0;
  const networkLastAt = Number(config.backupLastAt) || 0;

  const dueLocal = localEnabled && now - localLastAt > ONE_DAY_MS;
  const dueNetwork = networkEnabled && now - networkLastAt > ONE_DAY_MS;

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
  }, ONE_DAY_MS));
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
