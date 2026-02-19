const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("otto", {
  getConfig: () => ipcRenderer.invoke("otto:config:get"),
  saveConfig: (config) => ipcRenderer.invoke("otto:config:set", config),
  testConnection: (payload) => ipcRenderer.invoke("otto:connection:test", payload),
  outboxGet: () => ipcRenderer.invoke("otto:outbox:get"),
  outboxReplace: (items) => ipcRenderer.invoke("otto:outbox:replace", items),
  outboxClear: () => ipcRenderer.invoke("otto:outbox:clear"),
  getPendingActivationCode: () => ipcRenderer.invoke("otto:activationCode:get"),
  clearPendingActivationCode: () => ipcRenderer.invoke("otto:activationCode:clear"),
  showHostAddresses: () => ipcRenderer.invoke("otto:hostAddresses:show"),
  getHostInfo: () => ipcRenderer.invoke("otto:hostInfo:get"),
  discoverHosts: (payload) => ipcRenderer.invoke("otto:hosts:discover", payload),
  setWindowMinWidth: (width) => ipcRenderer.invoke("otto:window:set-min-width", width),
  showDiagnostics: () => ipcRenderer.invoke("otto:diagnostics:show"),
  exportSupportBundle: () => ipcRenderer.invoke("otto:supportBundle:export"),
});
