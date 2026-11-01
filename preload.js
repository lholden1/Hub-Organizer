'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('data:load'),
  save: (d) => ipcRenderer.invoke('data:save', d),
  saveSync: (d) => ipcRenderer.sendSync('data:save-sync', d),
  chooseLocation: (current) => ipcRenderer.invoke('data:choose-location', current),
  exportData: (d) => ipcRenderer.invoke('data:export', d),
  importData: () => ipcRenderer.invoke('data:import'),
  launch: (node) => ipcRenderer.invoke('launch', node),
  pickApp: () => ipcRenderer.invoke('pick-app'),
  fetchFavicon: (url) => ipcRenderer.invoke('icon:favicon', url),
  appIcon: (p) => ipcRenderer.invoke('icon:app', p),
  pickImage: () => ipcRenderer.invoke('icon:pick'),
  onExternalChange: (cb) => ipcRenderer.on('data:external-change', () => cb()),
  version: () => ipcRenderer.invoke('app:version'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:state', (_e, u) => cb(u)),
});
