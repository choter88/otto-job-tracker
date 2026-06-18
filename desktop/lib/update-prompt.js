// Update-install confirmation prompt (Phase 2 of the LAN-first plan).
//
// Electron-free so it is unit-testable. Builds the dialog shown before an
// update restarts the Host. With always-on, an install briefly takes the
// office offline, so when remote workstations are connected the copy says so
// and defaults to "Later" (the safe choice). The connected count excludes the
// Host's own loopback browser (see __ottoGetConnectedClientCount), so a count
// > 0 means real workstations would be interrupted.

export function buildUpdateInstallPrompt(clientCount, version) {
  const count = Number.isFinite(clientCount) && clientCount > 0 ? clientCount : 0;
  const hasClients = count > 0;
  return {
    type: "question",
    title: "Install update",
    message: version ? `Install version ${version}?` : "Install the update?",
    detail: hasClients
      ? `${count} workstation${count !== 1 ? "s are" : " is"} connected. ` +
        "Installing restarts Otto on this computer, so the office goes offline for a few seconds and workstations briefly can't make changes. Your saved work is safe."
      : "Otto will close, install the update, and reopen.",
    buttons: ["Install & Restart", "Later"],
    // When workstations are connected, default to the non-destructive choice.
    defaultId: hasClients ? 1 : 0,
    cancelId: 1,
  };
}
