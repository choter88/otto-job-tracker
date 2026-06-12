const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("otto", {
  getConfig: () => ipcRenderer.invoke("otto:config:get"),
  saveConfig: (config) => ipcRenderer.invoke("otto:config:set", config),
  testConnection: (payload) => ipcRenderer.invoke("otto:connection:test", payload),
  outboxGet: () => ipcRenderer.invoke("otto:outbox:get"),
  outboxReplace: (items) => ipcRenderer.invoke("otto:outbox:replace", items),
  outboxClear: () => ipcRenderer.invoke("otto:outbox:clear"),
  showHostAddresses: () => ipcRenderer.invoke("otto:hostAddresses:show"),
  getHostInfo: () => ipcRenderer.invoke("otto:hostInfo:get"),
  discoverHosts: (payload) => ipcRenderer.invoke("otto:hosts:discover", payload),
  setWindowMinWidth: (width) => ipcRenderer.invoke("otto:window:set-min-width", width),
  openSmsDraft: (payload) => ipcRenderer.invoke("otto:sms:draft:open", payload),
  portalFindHost: (payload) => ipcRenderer.invoke("otto:portal:find-host", payload),
  portalDesktopAuth: (payload) => ipcRenderer.invoke("otto:portal:desktop-auth", payload),
  validateInviteCode: (payload) => ipcRenderer.invoke("otto:portal:validate-invite-code", payload),
  clientRegister: (payload) => ipcRenderer.invoke("otto:portal:client-register", payload),
  setupBootstrap: (payload) => ipcRenderer.invoke("otto:setup:bootstrap", payload),
  setupPickSnapshot: () => ipcRenderer.invoke("otto:setup:pick-snapshot"),
  setupImportSnapshot: (payload) => ipcRenderer.invoke("otto:setup:import-snapshot", payload),
  setupComplete: () => ipcRenderer.invoke("otto:setup:complete"),
  openExternal: (url) => ipcRenderer.invoke("otto:external:open", url),
  showDiagnostics: () => ipcRenderer.invoke("otto:diagnostics:show"),
  exportSupportBundle: () => ipcRenderer.invoke("otto:supportBundle:export"),
  importPickCsv: () => ipcRenderer.invoke("otto:import:pick-csv"),
  releaseClient: () => ipcRenderer.invoke("otto:client:release"),
  storeRecoveryToken: (payload) => ipcRenderer.invoke("otto:client:recovery:store", payload),
  lookupRecovery: () => ipcRenderer.invoke("otto:client:recovery:lookup"),
  applyRecovery: (payload) => ipcRenderer.invoke("otto:client:recovery:apply", payload),

  // Order-sheet folder automation
  orderSheetsGet: () => ipcRenderer.invoke("otto:orderSheets:get"),
  orderSheetsPickFolder: () => ipcRenderer.invoke("otto:orderSheets:pick-folder"),
  orderSheetsConfigure: (payload) => ipcRenderer.invoke("otto:orderSheets:configure", payload),
  orderSheetsExtract: (payload) => ipcRenderer.invoke("otto:orderSheets:extract", payload),
  orderSheetsReadBytes: (payload) => ipcRenderer.invoke("otto:orderSheets:read-bytes", payload),
  orderSheetsAck: (payload) => ipcRenderer.invoke("otto:orderSheets:ack", payload),
  // Hand a saved sheet's bytes to the OS's own PDF viewer (Preview etc).
  orderSheetsOpenExternal: (payload) => ipcRenderer.invoke("otto:orderSheets:open-external", payload),
  // Push events from the watcher (new pending file, status change).
  // Returns an unsubscribe function for React effect cleanup.
  onOrderSheetsEvent: (callback) => {
    const listener = (_event, payload) => {
      try {
        callback(payload);
      } catch {
        // never let a renderer callback error break the IPC listener
      }
    };
    ipcRenderer.on("otto:orderSheets:event", listener);
    return () => ipcRenderer.removeListener("otto:orderSheets:event", listener);
  },
});
