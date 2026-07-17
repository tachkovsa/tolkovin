const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tolkovin', {
  onStart: (cb) => ipcRenderer.on('start-recording', cb),
  onStop: (cb) => ipcRenderer.on('stop-recording', cb),
  sendAudioSegments: (segments) => ipcRenderer.send('audio-segments-captured', segments),
  getMicDeviceId: () => ipcRenderer.invoke('get-mic-device-id'),
});
