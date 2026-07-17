const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tolkovinOverlay', {
  onState: (cb) => ipcRenderer.on('overlay-state', (_e, state, startedAt) => cb(state, startedAt)),
});
