const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("echobotDesktop", {
  openControlPanel() {
    return ipcRenderer.invoke("desktop:open-control-panel");
  },
  getGlobalCursorState() {
    return ipcRenderer.invoke("desktop:get-global-cursor-state");
  },
  startWindowDrag() {
    return ipcRenderer.invoke("desktop:start-window-drag");
  }
});
