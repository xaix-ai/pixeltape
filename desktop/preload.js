// Gives the pages a tiny, safe API — nothing else from Node is exposed.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pixeltapeDesktop", {
  // full player window
  setMini: on => ipcRenderer.send("pixeltape:set-mini", Boolean(on)),
  minimize: () => ipcRenderer.send("pixeltape:minimize"),
  close: () => ipcRenderer.send("pixeltape:close"),
  sendState: state => ipcRenderer.send("pixeltape:state", state),
  onCommand: callback => ipcRenderer.on("pixeltape:command", (_event, name) => callback(name)),
  onUpdate: callback => ipcRenderer.on("pixeltape:update", (_event, info) => callback(info)),
  openExternal: url => ipcRenderer.send("pixeltape:open-url", String(url)),
  // floating cassette window
  command: name => ipcRenderer.send("pixeltape:command", String(name)),
  onState: callback => ipcRenderer.on("pixeltape:state", (_event, state) => callback(state))
});
