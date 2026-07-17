const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tolkovinOverlay', {
  onState: (cb) => ipcRenderer.on('overlay-state', (_e, state, startedAt) => cb(state, startedAt)),
  retry: () => ipcRenderer.send('overlay-retry'),
  cancel: () => ipcRenderer.send('overlay-cancel'),
});
