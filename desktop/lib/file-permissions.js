/**
 * Cross-platform file permission enforcement (F-06).
 *
 * On POSIX (macOS/Linux), file permissions are set via the `mode` parameter
 * of fs.writeFileSync/mkdirSync. On Windows, POSIX modes are silently ignored,
 * so we use icacls to restrict file access to the current user only.
 */

import { platform } from "os";
import { execFileSync } from "child_process";

/**
 * Restrict a file or directory so only the current Windows user can read/write it.
 * No-op on non-Windows platforms (POSIX mode param handles it).
 *
 * @param {string} filePath — absolute path to restrict
 * @param {"file"|"dir"} type — whether this is a file or directory
 */
export function restrictToCurrentUser(filePath, type = "file") {
  if (platform() !== "win32") return;

  try {
    const username = process.env.USERNAME || process.env.USER;
    if (!username) {
      console.warn("[file-permissions] Cannot determine username; skipping ACL restriction for", filePath);
      return;
    }

    const perms = type === "dir" ? "(OI)(CI)F" : "(R,W)";
    execFileSync("icacls", [
      filePath,
      "/inheritance:r",                     // Remove inherited permissions
      "/grant:r", `${username}:${perms}`,   // Grant only current user
    ], { stdio: "ignore", timeout: 5000 });
  } catch (err) {
    console.warn(`[file-permissions] Failed to restrict ${filePath}:`, err?.message || err);
  }
}
