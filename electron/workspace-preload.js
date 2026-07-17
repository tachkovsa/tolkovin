const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tolkovinApp', {
  settings: {
    getConfig: () => ipcRenderer.invoke('settings:get-config'),
    saveConfig: (partial) => ipcRenderer.invoke('settings:save-config', partial),
    getStats: () => ipcRenderer.invoke('settings:get-stats'),
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    retryTranscribe: (id) => ipcRenderer.invoke('history:retry-transcribe', id),
    retryPaste: (id) => ipcRenderer.invoke('history:retry-paste', id),
    copy: (text) => ipcRenderer.invoke('history:copy', text),
    getAudioSrcs: (id) => ipcRenderer.invoke('history:get-audio-srcs', id),
    delete: (id) => ipcRenderer.invoke('history:delete', id),
  },
});
