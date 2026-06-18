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
