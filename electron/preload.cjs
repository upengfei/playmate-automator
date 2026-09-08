const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("playflowAgent", {
  isElectron: true,
  getInfo: () => ipcRenderer.invoke("agent:info"),
  checkForUpdates: () => ipcRenderer.invoke("agent:check-updates"),
  onTrayAction: (cb) => ipcRenderer.on("agent:tray-action", (_e, data) => cb(data)),
  onUpdateStage: (cb) => ipcRenderer.on("agent:update-stage", (_e, data) => cb(data)),
});
