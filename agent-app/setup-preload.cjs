const { contextBridge, ipcRenderer } = require("electron");

/** 首次使用配置窗口的桥接：读取默认值 + 用节点令牌校验身份 */
contextBridge.exposeInMainWorld("agentSetup", {
  defaults: () => ipcRenderer.invoke("agent-setup:defaults"),
  verify: (payload) => ipcRenderer.invoke("agent-setup:verify", payload),
});
