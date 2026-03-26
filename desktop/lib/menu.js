import { Menu } from "electron";

export function setAppMenu(config, { app, shell, showHostAddresses, chooseNetworkBackupFolder, scheduleAutomaticBackups, runBackupToNetworkFolder, restoreDatabase, createSetupWindow, showDiagnostics, exportSupportBundle, checkForUpdates, installUpdate, getUpdateState }) {
  const isHost = config.mode === "host";
  const isDev = !app.isPackaged || process.env.NODE_ENV === "development";

  // Build the Help → update items based on current auto-updater state
  const updateState = typeof getUpdateState === "function" ? getUpdateState() : { status: "idle" };
  const isReady = updateState.status === "ready";
  const versionLabel = `Version ${app.getVersion()}`;

  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        ...(isHost
          ? [
              { label: "Show Host Address\u2026", click: () => showHostAddresses() },
              { type: "separator" },
              { label: "Choose Backup Folder\u2026", click: () => chooseNetworkBackupFolder().then(() => scheduleAutomaticBackups()) },
              { label: "Back Up Now", click: () => runBackupToNetworkFolder({ interactive: true, reason: "manual" }) },
              { label: "Restore Data\u2026", click: () => restoreDatabase() },
              { type: "separator" },
            ]
          : []),
        { label: "Change Connection\u2026", click: () => createSetupWindow() },
        { label: "Diagnostics\u2026", click: () => showDiagnostics() },
        { label: "Export Support Bundle\u2026", click: () => exportSupportBundle() },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        ...(isDev
          ? [
              { role: "reload" },
              { role: "forceReload" },
              { type: "separator" },
              { role: "toggleDevTools" },
              { type: "separator" },
            ]
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Help",
      submenu: [
        ...(process.platform !== "darwin"
          ? [
              {
                label: "About Otto Tracker",
                click: async () => {
                  const { dialog } = await import("electron");
                  dialog.showMessageBox({
                    type: "info",
                    title: "About Otto Tracker",
                    message: "Otto Tracker",
                    detail: `Version ${app.getVersion()}\n\nOptometry job tracking for your practice.`,
                    buttons: ["OK"],
                  });
                },
              },
              { type: "separator" },
            ]
          : []),
        {
          label: "Check for Updates\u2026",
          click: () => {
            if (typeof checkForUpdates === "function") checkForUpdates();
          },
        },
        {
          label: isReady
            ? `Install Update (v${updateState.version})\u2026`
            : "Download & Install Update",
          enabled: isReady,
          click: () => {
            if (typeof installUpdate === "function") installUpdate();
          },
        },
        { type: "separator" },
        { label: versionLabel, enabled: false },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
