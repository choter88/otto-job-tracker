const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("otto", {
  getConfig: () => ipcRenderer.invoke("otto:config:get"),
  saveConfig: (config) => ipcRenderer.invoke("otto:config:set", config),
  testConnection: (payload) => ipcRenderer.invoke("otto:connection:test", payload),
  outboxGet: () => ipcRenderer.invoke("otto:outbox:get"),
  outboxReplace: (items) => ipcRenderer.invoke("otto:outbox:replace", items),
  outboxClear: () => ipcRenderer.invoke("otto:outbox:clear"),
});
