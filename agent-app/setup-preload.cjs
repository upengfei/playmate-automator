const { contextBridge, ipcRenderer } = require("electron");

/** 首次启动配置窗口的桥接：读取默认值 + 提交注册 */
contextBridge.exposeInMainWorld("agentSetup", {
  defaults: () => ipcRenderer.invoke("agent-setup:defaults"),
  register: (payload) => ipcRenderer.invoke("agent-setup:register", payload),
});
