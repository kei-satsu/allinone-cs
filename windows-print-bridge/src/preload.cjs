const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("printBridge", {
  state: () => ipcRenderer.invoke("bridge:state"),
  printers: () => ipcRenderer.invoke("bridge:printers"),
  rotate: () => ipcRenderer.invoke("bridge:rotate"),
});
