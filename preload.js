const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    // Remove listener helper if it exists to avoid multiple registrations
    ipcRenderer.removeAllListeners(channel);
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  }
});
