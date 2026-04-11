const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("echobotDesktop", {
  openControlPanel() {
    return ipcRenderer.invoke("desktop:open-control-panel");
  },
  startWindowDrag() {
    return ipcRenderer.invoke("desktop:start-window-drag");
  }
});
