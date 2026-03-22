import { Menu } from "electron";

export function setAppMenu(config, { app, shell, showHostAddresses, chooseNetworkBackupFolder, scheduleAutomaticBackups, runBackupToNetworkFolder, restoreDatabase, createSetupWindow, showDiagnostics, exportSupportBundle }) {
  const isHost = config.mode === "host";
  const isDev = !app.isPackaged || process.env.NODE_ENV === "development";

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
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
