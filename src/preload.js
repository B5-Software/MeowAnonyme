const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startTor: () => ipcRenderer.invoke('start-tor'),
  stopTor: () => ipcRenderer.invoke('stop-tor'),
  getTorStatus: () => ipcRenderer.invoke('get-tor-status'),
  getTorLogs: () => ipcRenderer.invoke('get-tor-logs'),
  clearData: () => ipcRenderer.invoke('clear-data'),
  clearTorLog: () => ipcRenderer.invoke('clear-tor-log'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),

  // 网桥配置相关API
  addBridge: (bridge) => ipcRenderer.invoke('add-bridge', bridge),
  saveBridgeConfig: () => ipcRenderer.invoke('save-bridge-config'),
  autoConfigureBridge: (bridgeType) => ipcRenderer.invoke('auto-configure-bridge', bridgeType),
  resetBridgeConfig: (bridgeType) => ipcRenderer.invoke('reset-bridge-config', bridgeType),

  windowAction: (action) => ipcRenderer.send('window-action', action),
    // 监听Tor日志和状态
  onTorLog: (callback) => ipcRenderer.on('tor-log', (_, log) => callback(log)),
  onTorStatus: (callback) => ipcRenderer.on('tor-status', (_, status) => callback(status)),
  onOpenNewTab: (callback) => ipcRenderer.on('open-new-tab', (_, url) => callback(url)),
  onThemeChange: (callback) => ipcRenderer.on('theme-change', (_, theme) => callback(theme)),
    // 打开外部链接
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  openTorLog: () => ipcRenderer.invoke('open-tor-log'), // 新增
  readTorLogFile: () => ipcRenderer.invoke('get-tor-logs'), // 新增
  setTorProxy: (useTor) => ipcRenderer.invoke('set-tor-proxy', useTor),
  downloadPage: (url) => ipcRenderer.invoke('download-page', url),
  screenshot: () => ipcRenderer.invoke('screenshot'),
  addBookmark: (bookmark) => ipcRenderer.invoke('add-bookmark', bookmark),
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  removeBookmark: (url) => ipcRenderer.invoke('remove-bookmark', url),  getCertificate: (url) => ipcRenderer.invoke('get-certificate', url),
  
  // 简易广告拦截相关API
  openAdblock: () => ipcRenderer.invoke('open-adblock'),
  getAdblockStats: () => ipcRenderer.invoke('get-adblock-stats'),
  clearAdblockStats: () => ipcRenderer.invoke('clear-adblock-stats'),
  
  // 新增torrc编辑相关API
  getTorrcContent: () => ipcRenderer.invoke('get-torrc-content'),
  saveTorrcContent: (content) => ipcRenderer.invoke('save-torrc-content', content),
  
  // 获取HTTP响应头
  getResponseHeaders: (url) => ipcRenderer.invoke('get-response-headers', url),
});