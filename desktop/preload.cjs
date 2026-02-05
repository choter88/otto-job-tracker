const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("otto", {
  getConfig: () => ipcRenderer.invoke("otto:config:get"),
  saveConfig: (config) => ipcRenderer.invoke("otto:config:set", config),
});

