// Always-on host gating (Workstream A of the LAN-first plan).
//
// Deliberately Electron-free (plain logic only) so it is unit-testable and so
// the gate can be reasoned about in one place. Two layers:
//
//   1. Capability — OTTO_ALWAYS_ON_HOST must be "true" for ANY always-on
//      behavior to exist. The app turns this ON by default for installed builds
//      (applyOfflineDefaults), so the gate is normally satisfied; setting
//      OTTO_ALWAYS_ON_HOST=false opts a whole build out and makes every
//      always-on code path inert (quit-on-close, no login item, no tray).
//   2. Per-machine preference — once capable, the behavior is ON for a Host by
//      default and a user can opt this machine out via the Host menu, which
//      writes config.alwaysOnHost = false. A shared front-desk machine can thus
//      decline while a dedicated back-office box stays on.
//
// Always-on only applies in Host mode; a Client has no server to keep alive.

export function isAlwaysOnHostCapable(env = process.env) {
  return env?.OTTO_ALWAYS_ON_HOST === "true";
}

export function isAlwaysOnHostActive(config, env = process.env) {
  return (
    isAlwaysOnHostCapable(env) &&
    config?.mode === "host" &&
    config?.alwaysOnHost !== false
  );
}

// Whether the app should run RESIDENT — keep a tray, stay alive with all
// windows closed, and auto-start at login. Unifies the host's always-on gate
// with the client equivalent so the four resident-behavior sites share one
// predicate. Host-SERVER semantics (shutdown backup, connected-client warning)
// keep using isAlwaysOnHostActive, NOT this.
//
// Default-on once capable: a Host stays resident unless alwaysOnHost === false;
// a Client stays resident unless keepClientResident === false. Both fields are
// absent from getDefaultConfig and written only on opt-out.
export function isResidentApp(config, env = process.env) {
  if (!isAlwaysOnHostCapable(env)) return false;
  if (config?.mode === "host") return config?.alwaysOnHost !== false;
  if (config?.mode === "client") return config?.keepClientResident !== false;
  return false;
}

// The window-all-closed decision (non-macOS): keep the process alive (resident)
// only AFTER setup is complete. During setup there is no Host server/office to
// keep alive, so closing the setup window must quit rather than strand a
// headless process with no tray (the reported Windows bug). A real quit always
// proceeds. The caller must still confirm a tray exists before staying headless
// — being resident-eligible is necessary, not sufficient.
export function shouldStayResidentOnAllClosed({ isQuitting, setupComplete, config } = {}, env = process.env) {
  if (isQuitting) return false;
  if (!setupComplete) return false;
  return isResidentApp(config, env);
}

// The per-machine opt-out field the resident toggle flips, by mode. Host and
// client keep separate fields so a client toggle never mutates host semantics.
export function residentToggleField(mode) {
  return mode === "host" ? "alwaysOnHost" : "keepClientResident";
}

// Mode-specific copy for the tray, tooltip, and the one-time hide-to-tray
// notice. A client has no embedded server and no connected-workstation count,
// so its copy avoids server/office-offline language. Kept here (Electron-free)
// so it is unit-testable.
export function residentCopy(mode) {
  const isHost = mode === "host";
  return {
    trayTooltip: isHost ? "Otto Tracker — office server" : "Otto Tracker",
    trayStatusLabel: isHost ? "Otto server is running" : "Otto is connected to the office",
    trayQuitLabel: isHost ? "Quit Otto (take office offline)" : "Quit Otto",
    showWorkstationCount: isHost,
    hiddenNoticeBody: isHost
      ? "Workstations stay connected. Click the Otto icon in the menu bar / taskbar to reopen this window."
      : "Otto stays running. Click the Otto icon in the taskbar / menu bar to reopen this window.",
  };
}

// Whether launchMainWindowForConfig must run the host server bring-up (port
// pre-flight + start + readiness wait) for this launch. True only for a Host
// whose embedded server is NOT already running in this process.
//
// The reason this is a gate and not just `mode === "host"`: on a REOPEN (the
// window was destroyed but the always-on server kept running), the port is
// legitimately held by our OWN server. Re-running the pre-flight sees the port
// in use, refuses to kill its own PID, and shows a spurious "port in use"
// dialog — trapping the user behind a window that won't reopen until they quit.
// Skipping the bring-up when the server is already up makes reopen idempotent.
//
// Independent of the always-on capability on purpose: even a non-always-on Host
// must never double-start its server within one process lifetime.
export function shouldStartHostServer(config, hostServerStarted) {
  return config?.mode === "host" && !hostServerStarted;
}
