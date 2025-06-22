const { app, BrowserWindow, session, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
// electron-store v8 使用标准require
const Store = require('electron-store');

// 判断是否为开发环境
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// 获取资源路径
function getResourcePath(relativePath) {
  if (isDev) {
    return path.join(__dirname, '..', relativePath);
  } else {
    // 打包后的资源处理
    if (relativePath.startsWith('src/tor/')) {
      // Tor二进制文件在extraResources中
      const torSubPath = relativePath.replace('src/tor/', '');
      return path.join(process.resourcesPath, 'tor', torSubPath);
    } else if (relativePath.startsWith('views/') || relativePath.startsWith('styles/') || relativePath.startsWith('assets/')) {
      // 视图、样式和资源文件在app.asar中
      return path.join(__dirname, '..', relativePath);
    } else {
      // 其他资源在app目录中
      return path.join(__dirname, '..', relativePath);
    }
  }
}

// 获取Tor配置文件路径
function getTorrcPath() {
  if (isDev) {
    return path.join(__dirname, 'torrc');
  } else {
    // 打包后从extraResources获取
    return path.join(process.resourcesPath, 'torrc');
  }
}

// 获取用户数据路径
function getUserDataPath(filename) {
  return path.join(app.getPath('userData'), filename);
}

// 配置存储
const store = new Store({  defaults: {
    theme: 'light',  // 默认浅色主题
    accentColor: '#4ecdc4',  // 默认主题色
    homepage: 'https://www.bing.com/',  // 默认主页
    searchEngine: 'bing',  // 默认搜索引擎
    customSearchUrl: '',  // 自定义搜索URL
    bridgeType: 'obfs4',
    bridges: [],
    useBridges: false,  // 是否使用网桥
    torEnabled: false,
    proxyEnabled: false,  // 前置代理默认关闭
    proxyConfig: { host: '', username: '', password: '' },  // 默认代理配置
    bookmarks: [],
    // 隐私保护设置
    privacyLevel: 'high',  // 隐私保护级别: low, medium, high
    customUserAgent: '',   // 自定义User-Agent
    spoofFingerprint: true // 是否伪装浏览器指纹
  }
});

let mainWindow;
let torProcess = null;
let torLogs = [];
let settingsWindow = null;
let torLogWindow = null; // 新增Tor日志窗口
// 简易广告拦截统计数据
let adBlockStats = {
  blockedCount: 0,
  blockedToday: 0,
  dailyReset: new Date().toDateString()
};

const torLogFile = getUserDataPath('tor.log');

// 简易广告拦截功能
function setupSimpleAdblocker() {
  console.log('🛡️ 启用简易广告拦截');
  
  const { webRequest } = session.defaultSession;
  
  // 基础广告域名列表
  const adDomains = [
    '*://googleads.g.doubleclick.net/*',
    '*://pagead2.googlesyndication.com/*',
    '*://google-analytics.com/*',
    '*://googletagmanager.com/*',
    '*://facebook.com/tr/*',
    '*://connect.facebook.net/*',
    '*://amazon-adsystem.com/*',
    '*://outbrain.com/*',
    '*://taboola.com/*',
    '*://*.ads.yahoo.com/*',
    '*://cpro.baidu.com/*',
    '*://pos.baidu.com/*'
  ];
  
  // 拦截广告请求
  webRequest.onBeforeRequest({ 
    urls: adDomains
  }, (details, callback) => {
    updateSimpleAdStats();
    console.log('🚫 拦截广告:', details.url);
    callback({ cancel: true });
  });
    // 拦截包含广告关键词的URL
  webRequest.onBeforeRequest({
    urls: ['<all_urls>']
  }, (details, callback) => {
    const url = details.url.toLowerCase();
    
    // 简单的广告关键词检测
    const adKeywords = ['/ads/', '/ad/', '/advertisement/', 'googleads', 'doubleclick'];
    const hasAdKeyword = adKeywords.some(keyword => url.includes(keyword));
    
    // 排除重要页面
    const isImportant = url.includes('login') || url.includes('auth') || url.includes('payment');
    
    if (hasAdKeyword && !isImportant && !url.includes('localhost')) {
      updateSimpleAdStats();
      console.log('🚫 拦截可疑广告:', details.url);
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  });
    // 设置最小化User-Agent，保护用户隐私
  webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = details.requestHeaders;
    const config = store.get();
    
    // 根据用户配置生成User-Agent
    const userAgent = generateUserAgent(config.privacyLevel, config.customUserAgent);
    headers['User-Agent'] = userAgent;
    
    // 移除可能泄露隐私的请求头
    delete headers['X-Requested-With'];
    delete headers['X-Forwarded-For'];
    delete headers['X-Real-IP'];
    delete headers['X-Client-IP'];
    delete headers['X-Forwarded-Host'];
    delete headers['X-Forwarded-Proto'];
    delete headers['X-Original-URL'];
    delete headers['CF-Connecting-IP'];
    delete headers['True-Client-IP'];
    
    // 添加隐私保护头部
    headers['DNT'] = '1';  // Do Not Track
    headers['Sec-GPC'] = '1';  // Global Privacy Control
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = 'none';
    headers['Sec-Fetch-User'] = '?1';
    
    // 根据隐私级别设置不同的Accept头部
    if (config.privacyLevel === 'high') {
      headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
      headers['Accept-Language'] = 'en-US,en;q=0.5';
      headers['Accept-Encoding'] = 'gzip, deflate';
    } else {
      headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
      headers['Accept-Language'] = 'en-US,en;q=0.5';
      headers['Accept-Encoding'] = 'gzip, deflate, br';
    }
    
    console.log(`🔒 已设置${config.privacyLevel}级别User-Agent:`, userAgent);
    callback({ requestHeaders: headers });
  });
  
  // 修改响应头，增强隐私保护
  webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = details.responseHeaders || {};
    
    // 移除可能的跟踪头部
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    delete headers['Server'];
    delete headers['X-Powered-By'];
    delete headers['X-AspNet-Version'];
    delete headers['X-AspNetMvc-Version'];
    
    // 添加隐私保护头部
    headers['X-Content-Type-Options'] = ['nosniff'];
    headers['X-Frame-Options'] = ['DENY'];
    headers['Referrer-Policy'] = ['no-referrer'];
    headers['X-XSS-Protection'] = ['1; mode=block'];
    headers['Permissions-Policy'] = ['geolocation=(), microphone=(), camera=()'];
    
    callback({ responseHeaders: headers });
  });
  
  console.log('✅ 简易广告拦截已启用');
}

// 根据隐私级别生成User-Agent
function generateUserAgent(privacyLevel, customUA) {
  if (customUA && customUA.trim()) {
    return customUA.trim();
  }
  
  const userAgents = {
    low: navigator.userAgent, // 使用真实的User-Agent
    medium: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    high: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };
  
  return userAgents[privacyLevel] || userAgents.high;
}

// 更新简易广告拦截统计
function updateSimpleAdStats() {
  const today = new Date().toDateString();
  if (adBlockStats.dailyReset !== today) {
    adBlockStats.blockedToday = 0;
    adBlockStats.dailyReset = today;
  }
  
  adBlockStats.blockedCount++;
  adBlockStats.blockedToday++;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: getResourcePath('assets/icons/icon.ico'), // 添加图标
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,  // 允许webview加载外部内容
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
      webviewTag: true  // 明确启用webview标签
    },
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e1e'
  });
  mainWindow.loadFile(getResourcePath('views/index.html'));  // 设置最小化User-Agent for主窗口
  const appConfig = store.get();
  const userAgent = generateUserAgent(appConfig.privacyLevel, appConfig.customUserAgent);
  mainWindow.webContents.setUserAgent(userAgent);
  console.log(`🔒 已为主窗口设置${appConfig.privacyLevel}级别User-Agent:`, userAgent);

  // 设置无痕模式
  session.defaultSession.clearStorageData();
  // 启动时设置系统代理 (默认走系统代理)
  console.log('启动配置:', appConfig);
  
  // 启动时总是从系统代理开始，而不是直接使用Tor
  // 只有在Tor进程100%启动后才自动切换到Tor代理
  setProxy('system');
  
  // 清除torEnabled状态，确保启动时不会直接使用Tor代理
  store.set('torEnabled', false);
    // 生成初始torrc配置
  generateTorrc();
  
  // 启用简易广告拦截
  setupSimpleAdblocker();

  // 监听 webview 新窗口请求，转为新标签页
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 通知渲染进程在新标签页打开链接
    mainWindow.webContents.send('open-new-tab', url);
    return { action: 'deny' };
  });
  // 监听所有webview的新窗口请求
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    // 设置新窗口处理器
    webContents.setWindowOpenHandler(({ url }) => {
      mainWindow.webContents.send('open-new-tab', url);
      return { action: 'deny' };
    });
      // 为webview设置最小化User-Agent
    const appConfig = store.get();
    const userAgent = generateUserAgent(appConfig.privacyLevel, appConfig.customUserAgent);
    webContents.setUserAgent(userAgent);
    console.log(`🔒 已为webview设置${appConfig.privacyLevel}级别User-Agent`);
    
    // 监听webview的导航事件，确保每次导航都使用最小化UA
    webContents.on('will-navigate', (event, navigationUrl) => {
      const currentConfig = store.get();
      const currentUA = generateUserAgent(currentConfig.privacyLevel, currentConfig.customUserAgent);
      webContents.setUserAgent(currentUA);
    });
    
    // 监听webview的DOM准备事件，注入隐私保护脚本
    webContents.on('dom-ready', () => {
      const currentConfig = store.get();
      if (currentConfig.spoofFingerprint) {
        webContents.executeJavaScript(`
          // 隐私保护：覆盖navigator对象中的敏感信息
          if (typeof navigator !== 'undefined') {
            try {
              // 最小化navigator信息
              Object.defineProperty(navigator, 'userAgent', {
                get: () => '${userAgent}',
                configurable: false
              });
              
              Object.defineProperty(navigator, 'platform', {
                get: () => 'Win32',
                configurable: false
              });
              
              Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
                configurable: false
              });
              
              Object.defineProperty(navigator, 'language', {
                get: () => 'en-US',
                configurable: false
              });
              
              // 移除可能泄露信息的属性
              if (navigator.deviceMemory) {
                Object.defineProperty(navigator, 'deviceMemory', {
                  get: () => 4,
                  configurable: false
                });
              }
              
              if (navigator.hardwareConcurrency) {
                Object.defineProperty(navigator, 'hardwareConcurrency', {
                  get: () => 4,
                  configurable: false
                });
              }
              
              // 覆盖屏幕信息
              if (typeof screen !== 'undefined') {
                Object.defineProperty(screen, 'width', {
                  get: () => 1920,
                  configurable: false
                });
                
                Object.defineProperty(screen, 'height', {
                  get: () => 1080,
                  configurable: false
                });
                
                Object.defineProperty(screen, 'availWidth', {
                  get: () => 1920,
                  configurable: false
                });
                
                Object.defineProperty(screen, 'availHeight', {
                  get: () => 1040,
                  configurable: false
                });
                
                Object.defineProperty(screen, 'colorDepth', {
                  get: () => 24,
                  configurable: false
                });
                
                Object.defineProperty(screen, 'pixelDepth', {
                  get: () => 24,
                  configurable: false
                });
              }
              
              console.log('🔒 隐私保护脚本已注入');
            } catch (e) {
              // 忽略脚本注入错误
            }
          }
        `).catch(() => {
          // 忽略脚本执行错误
        });
      }
    });
  });
}


function generateTorrc() {
  const config = store.get();
  const torDataDir = getUserDataPath('tor_data');
  const geoipFile = getResourcePath('src/tor/data/geoip');
  const geoip6File = getResourcePath('src/tor/data/geoip6');
  
  // 确保数据目录存在
  if (!fs.existsSync(torDataDir)) {
    fs.mkdirSync(torDataDir, { recursive: true });
  }
  
  let torrcContent = `SocksPort 9050
ControlPort 9051
HashedControlPassword 16:872860B76453A77D60CA2BB8C1A7042072093276A3D701AD684053EC4C
DataDirectory ${torDataDir.replace(/\\/g, '/')}
`;

  // 只有在GeoIP文件存在时才添加配置
  if (fs.existsSync(geoipFile)) {
    torrcContent += `GeoIPFile ${geoipFile.replace(/\\/g, '/')}\n`;
  }
  if (fs.existsSync(geoip6File)) {
    torrcContent += `GeoIPv6File ${geoip6File.replace(/\\/g, '/')}\n`;
  }
    // 网桥配置
  if (config.useBridges && config.bridges && config.bridges.length > 0) {
    torrcContent += `UseBridges 1\n`;
    
    // 根据网桥类型添加传输插件配置
    const pluginPath = getResourcePath('src/tor/pluggable_transports/lyrebird.exe').replace(/\\/g, '/');
    if (config.bridgeType === 'snowflake') {
      torrcContent += `ClientTransportPlugin snowflake exec ${pluginPath}\n`;
    } else if (config.bridgeType === 'meek-azure') {
      torrcContent += `ClientTransportPlugin meek_lite exec ${pluginPath}\n`;
    } else if (config.bridgeType === 'obfs4') {
      torrcContent += `ClientTransportPlugin obfs4 exec ${pluginPath}\n`;
    }
    
    // 添加网桥地址
    config.bridges.forEach(bridge => {
      torrcContent += `Bridge ${bridge}\n`;
    });
  } else {
    // 确保关闭网桥时明确设置为0
    torrcContent += `UseBridges 0\n`;
  }
  
  // 前置代理配置 - 只有在启用时才写入
  if (config.proxyEnabled && config.proxyConfig && config.proxyConfig.host) {
    const [host, port] = config.proxyConfig.host.split(':');
    if (host && port) {
      torrcContent += `HTTPSProxy ${host}:${port}\n`;
      if (config.proxyConfig.username && config.proxyConfig.password) {
        torrcContent += `HTTPSProxyAuthenticator ${config.proxyConfig.username}:${config.proxyConfig.password}\n`;
      }
    }
  }
    console.log('生成的torrc内容:', torrcContent);
  const torrcPath = getUserDataPath('torrc');
  fs.writeFileSync(torrcPath, torrcContent);
}

// 生成torrc文件 (用于IPC调用) - 使用统一的生成函数
async function generateTorrcFile(config) {
  // 临时存储当前配置
  const currentConfig = store.get();
  // 设置新配置
  store.set(config);
  // 生成torrc
  generateTorrc();
  // 恢复原配置（如果需要的话）
  // 注：这里直接使用新配置，因为这是保存操作
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
    settingsWindow = new BrowserWindow({
    width: 600,
    height: 700,
    icon: getResourcePath('assets/icons/icon.ico'), // 添加图标
    parent: mainWindow,
    modal: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#ffffff',
    resizable: false
  });
  settingsWindow.loadFile(getResourcePath('views/settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function createTorLogWindow() {
  if (torLogWindow) {
    torLogWindow.focus();
    return;
  }  torLogWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Tor 连接日志',
    icon: getResourcePath('assets/icons/icon.ico'), // 修正图标路径
    parent: mainWindow,
    modal: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  // 加载独立的Tor日志HTML文件
  torLogWindow.loadFile(getResourcePath('views/tor-log.html'));
  torLogWindow.once('ready-to-show', () => torLogWindow.show());
  torLogWindow.on('closed', () => { torLogWindow = null; });
}

// 显示广告拦截状态窗口
function showAdblockStatus() {
  const adblockWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: '广告拦截状态',
    icon: path.join(__dirname, '../assets/icons/icon.ico'),
    parent: mainWindow,
    modal: false,
    resizable: false,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  adblockWindow.loadFile(getResourcePath('views/adblock-status.html'));
  adblockWindow.once('ready-to-show', () => adblockWindow.show());
}

async function startTor() {
  const torPath = getResourcePath('src/tor/tor.exe');
  const torrcPath = getUserDataPath('torrc');
  
  console.log('Tor可执行文件路径:', torPath);
  console.log('Tor配置文件路径:', torrcPath);
  
  // 检查tor.exe是否存在
  if (!fs.existsSync(torPath)) {
    throw new Error(`Tor可执行文件不存在: ${torPath}`);
  }
  
  // 生成torrc配置
  generateTorrc();
  
  // 清空旧日志
  try { fs.writeFileSync(torLogFile, ''); } catch {}
  
  // 启动Tor进程
  torProcess = spawn(torPath, ['-f', torrcPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  
  torProcess.stdout.on('data', (data) => {
    const log = data.toString();
    torLogs.push(log);
    fs.appendFileSync(torLogFile, log);
    if (mainWindow) {
      mainWindow.webContents.send('tor-log', log);
      // 检测到Tor 100%启动时自动切换代理并通知前端
      if (/Bootstrapped 100%/.test(log)) {
        console.log('Tor启动完成，切换到Tor代理');
        setProxy(true);
        store.set('torEnabled', true);
        mainWindow.webContents.send('tor-status', { connected: true });
      }
    }
  });
  
  torProcess.stderr.on('data', (data) => {
    const log = data.toString();
    torLogs.push(`ERROR: ${log}`);
    fs.appendFileSync(torLogFile, `ERROR: ${log}`);
    if (mainWindow) {
      mainWindow.webContents.send('tor-log', `ERROR: ${log}`);
    }
  });
  
  torProcess.on('close', (code) => {
    const msg = `Tor process exited with code ${code}\n`;
    torLogs.push(msg);
    fs.appendFileSync(torLogFile, msg);
    if (mainWindow) {
      mainWindow.webContents.send('tor-log', msg);
      mainWindow.webContents.send('tor-status', { connected: false });
    }
    console.log(`Tor process exited with code ${code}`);
    torProcess = null;
    setProxy(false);
    store.set('torEnabled', false);
  });

  return new Promise((resolve) => {
    torProcess.stdout.once('data', () => {
      resolve();
    });
  });
}

function setProxy(mode) {
  let proxyRules = '';
  
  if (mode === true || mode === 'tor') {
    // Tor代理
    proxyRules = 'socks5://127.0.0.1:9050';
  } else if (mode === 'system') {
    // 系统代理 - 让Electron使用系统代理设置
    proxyRules = 'system';
  } else {
    // 直连，不使用代理
    proxyRules = '';
  }
  
  console.log('设置代理模式:', mode, '代理规则:', proxyRules);
  session.defaultSession.setProxy({ 
    proxyRules: proxyRules,
    mode: mode === 'system' ? 'system' : 'fixed_servers'
  });
}

app.whenReady().then(() => {
  // 应用启动时清空Tor日志文件
  try { 
    fs.writeFileSync(torLogFile, ''); 
    console.log('已清空Tor日志文件');
  } catch (e) {
    console.error('清空Tor日志文件失败:', e);
  }
  
  createWindow();
  
  // 监听来自渲染进程的事件
  ipcMain.handle('start-tor', async () => {
    if (!torProcess) {
      startTor();
      return true;
    }
    return false;
  });
    ipcMain.handle('stop-tor', () => {
    if (torProcess) {
      torProcess.kill();
      torProcess = null;
      store.set('torEnabled', false);
      // 停止Tor后恢复系统代理
      console.log('Tor已停止，恢复系统代理');
      setProxy('system');
      if (mainWindow) {
        mainWindow.webContents.send('tor-status', { connected: false });
      }
      return true;
    }
    return false;
  });
  
  ipcMain.handle('get-tor-status', () => {
    return {
      running: torProcess !== null,
      connected: torProcess !== null,
      processId: torProcess ? torProcess.pid : null
    };
  });
  ipcMain.handle('get-tor-logs', () => {
    try {
      // 首先检查文件是否存在
      if (!fs.existsSync(torLogFile)) {
        console.log('Tor日志文件不存在:', torLogFile);
        return [];
      }
      
      const logContent = fs.readFileSync(torLogFile, 'utf-8');
      if (!logContent.trim()) {
        console.log('Tor日志文件为空');
        return [];
      }
      
      console.log('成功读取Tor日志文件，大小:', logContent.length, '字符');
      
      // 解析日志内容为结构化数据
      const lines = logContent.split('\n').filter(line => line.trim());
      const logs = lines.map((line, index) => {
        // 尝试解析Tor日志格式：Aug 15 10:30:45.123 [warn] message
        const torLogMatch = line.match(/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\[(\w+)\]\s+(.+)$/);
        if (torLogMatch) {
          const [, timestamp, level, message] = torLogMatch;
          // 将Tor的日期格式转换为完整日期
          const currentYear = new Date().getFullYear();
          const fullTimestamp = `${currentYear} ${timestamp}`;
          const parsedDate = new Date(fullTimestamp);
          
          return {
            id: index,
            timestamp: parsedDate.toISOString(),
            level: level.toLowerCase(),
            message: message.trim()
          };
        } else {
          // 如果不匹配标准格式，尝试其他格式或使用默认
          return {
            id: index,
            timestamp: new Date().toISOString(),
            level: 'info',
            message: line.trim()
          };
        }
      }).filter(log => log.message && log.message.length > 0);
      
      console.log('解析得到', logs.length, '条日志记录');
      return logs;
    } catch (error) {
      console.error('读取Tor日志失败:', error);
      console.log('日志文件路径:', torLogFile);
      
      // 返回内存中的日志作为fallback
      if (torLogs && torLogs.length > 0) {
        return torLogs.map((log, index) => ({
          id: index,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: typeof log === 'string' ? log.trim() : JSON.stringify(log)
        }));
      }
      
      return [];
    }
  });
  
  ipcMain.handle('clear-data', () => {
    session.defaultSession.clearStorageData();
    session.defaultSession.clearCache();
    return true;
  });
  
  ipcMain.handle('get-config', () => {
    return store.store;
  });  ipcMain.handle('update-config', (_, config) => {
    const oldConfig = store.get();
    store.set(config);
    
    // 检查主题是否变更，如果变更则通知所有窗口
    if (oldConfig.theme !== config.theme || oldConfig.accentColor !== config.accentColor) {
      // 通知主窗口主题变更
      if (mainWindow) {
        mainWindow.webContents.send('theme-change', {
          theme: config.theme,
          accentColor: config.accentColor
        });
      }
    }
    
    // 配置更新后重新生成torrc文件
    generateTorrc();
    return true;
  });
  
  ipcMain.handle('add-bridge', (_, bridge) => {
    const bridges = store.get('bridges') || [];
    bridges.push(bridge);
    store.set('bridges', bridges);
    return true;  });
  
  ipcMain.on('window-action', (_, action) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      switch (action) {
        case 'minimize': focusedWindow.minimize(); break;
        case 'maximize':
          if (focusedWindow.isMaximized()) {
            focusedWindow.unmaximize();
          } else {
            focusedWindow.maximize();
          }
          break;
        case 'close': focusedWindow.close(); break;
      }
    }
  });
  
  ipcMain.handle('open-settings', () => {
    createSettingsWindow();
    return true;
  });
  
  // 新增：打开Tor日志窗口
  ipcMain.handle('open-tor-log', () => {
    createTorLogWindow();
    return true;
  });
  
  // 新增：读取Tor日志文件
  ipcMain.handle('read-tor-log-file', () => {
    try {
      return fs.readFileSync(torLogFile, 'utf8');
    } catch (e) {
      return '';
    }
  });
  
  ipcMain.handle('set-tor-proxy', (_, useTor) => {
    setProxy(useTor);
    return true;
  });
  ipcMain.handle('download-page', async (_, url) => {
    // 让webview下载页面
    if (mainWindow) {
      mainWindow.webContents.downloadURL(url);
    }
    return true;
  });
  ipcMain.handle('screenshot', async () => {
    if (mainWindow) {
      const image = await mainWindow.webContents.capturePage();
      const filePath = dialog.showSaveDialogSync(mainWindow, {
        title: '保存截图',
        defaultPath: 'meow_screenshot.png',
        filters: [{ name: 'PNG图片', extensions: ['png'] }]
      });
      if (filePath) {
        fs.writeFileSync(filePath, image.toPNG());
        return filePath;
      }
    }
    return null;
  });
  ipcMain.handle('add-bookmark', (_, bookmark) => {
    const bookmarks = store.get('bookmarks') || [];
    bookmarks.push(bookmark);
    store.set('bookmarks', bookmarks);
    return true;
  });
  ipcMain.handle('get-bookmarks', () => {
    return store.get('bookmarks') || [];
  });
  ipcMain.handle('remove-bookmark', (_, url) => {
    let bookmarks = store.get('bookmarks') || [];
    bookmarks = bookmarks.filter(b => b.url !== url);
    store.set('bookmarks', bookmarks);
    return true;
  });  ipcMain.handle('get-certificate', async (_, url) => {
    // 证书信息获取 - 增强版本提供更多信息
    try {
      const https = require('https');
      const crypto = require('crypto');
      const urlObj = new URL(url);
      
      return new Promise((resolve) => {
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || 443,
          method: 'GET',
          rejectUnauthorized: false // 允许自签名证书
        };
          const req = https.request(options, (res) => {
          const cert = res.socket.getPeerCertificate(true);
          const protocol = res.socket.getProtocol();
          const cipher = res.socket.getCipher();
          
          console.log('原始证书对象:', cert);
          console.log('证书密钥:', Object.keys(cert));
          
          if (cert && Object.keys(cert).length > 0) {
            console.log('获取到证书信息');
            console.log('Subject:', cert.subject);
            console.log('Issuer:', cert.issuer);
            console.log('Valid from:', cert.valid_from);
            console.log('Valid to:', cert.valid_to);
            
            // 计算证书的SHA-256指纹
            let sha256Fingerprint = '';
            if (cert.raw) {
              sha256Fingerprint = crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase().match(/.{2}/g).join(':');
            }
            
            // 安全提取证书信息，避免undefined访问
            const getSubjectInfo = (field) => {
              if (cert.subject && typeof cert.subject === 'object') {
                return cert.subject[field] || '未提供';
              }
              return '未提供';
            };
            
            const getIssuerInfo = (field) => {
              if (cert.issuer && typeof cert.issuer === 'object') {
                return cert.issuer[field] || '未提供';
              }
              return '未提供';
            };
              // 解析有效期 - 改进版本
            let validFrom = null;
            let validTo = null;
            let daysRemaining = 0;
            let trustStatus = '未知';
            
            // 尝试多种日期格式解析
            try {
              if (cert.valid_from) {
                validFrom = new Date(cert.valid_from);
                // 检查是否是有效日期
                if (isNaN(validFrom.getTime())) {
                  validFrom = null;
                }
              }
            } catch (e) {
              console.warn('解析 valid_from 失败:', e);
              validFrom = null;
            }
            
            try {
              if (cert.valid_to) {
                validTo = new Date(cert.valid_to);
                // 检查是否是有效日期
                if (isNaN(validTo.getTime())) {
                  validTo = null;
                }
              }
            } catch (e) {
              console.warn('解析 valid_to 失败:', e);
              validTo = null;
            }
            
            const now = new Date();
            
            if (validFrom && validTo) {
              daysRemaining = Math.ceil((validTo - now) / (1000 * 60 * 60 * 24));
              if (now < validFrom) {
                trustStatus = '尚未生效';
              } else if (now > validTo) {
                trustStatus = '已过期';
              } else {
                trustStatus = '有效';
              }
            } else {
              trustStatus = '无法确定';
            }
            
            // 提取更多证书信息
            const certInfo = {
              subject: {
                CN: getSubjectInfo('CN'),
                O: getSubjectInfo('O'),
                OU: getSubjectInfo('OU'),
                C: getSubjectInfo('C'),
                ST: getSubjectInfo('ST'),
                L: getSubjectInfo('L'),
                emailAddress: getSubjectInfo('emailAddress')
              },
              issuer: {
                CN: getIssuerInfo('CN'),
                O: getIssuerInfo('O'),
                OU: getIssuerInfo('OU'),
                C: getIssuerInfo('C'),
                ST: getIssuerInfo('ST'),
                L: getIssuerInfo('L')
              },              validity: {
                valid_from: cert.valid_from || '未知',
                valid_to: cert.valid_to || '未知',
                valid_from_formatted: validFrom ? 
                  `${validFrom.getFullYear()}-${(validFrom.getMonth() + 1).toString().padStart(2, '0')}-${validFrom.getDate().toString().padStart(2, '0')} ${validFrom.getHours().toString().padStart(2, '0')}:${validFrom.getMinutes().toString().padStart(2, '0')}:${validFrom.getSeconds().toString().padStart(2, '0')}` : 
                  '未知',
                valid_to_formatted: validTo ? 
                  `${validTo.getFullYear()}-${(validTo.getMonth() + 1).toString().padStart(2, '0')}-${validTo.getDate().toString().padStart(2, '0')} ${validTo.getHours().toString().padStart(2, '0')}:${validTo.getMinutes().toString().padStart(2, '0')}:${validTo.getSeconds().toString().padStart(2, '0')}` : 
                  '未知',
                days_remaining: daysRemaining,
                is_valid: validFrom && validTo && (now >= validFrom && now <= validTo),
                status: trustStatus
              },
              fingerprints: {
                sha1: cert.fingerprint || '未知',
                sha256: sha256Fingerprint || '未知'
              },
              details: {
                serial_number: cert.serialNumber || '未知',
                version: 'v' + (cert.version || '3'),
                signature_algorithm: cert.sigalg || '未知',
                public_key_algorithm: cert.pubkey?.type || '未知',
                public_key_size: cert.pubkey?.bits || '未知',
                extensions: cert.ext_key_usage || []
              },
              connection: {
                protocol: protocol || 'TLS',
                cipher_suite: cipher?.name || '未知',
                cipher_version: cipher?.version || '未知'
              },
              san: cert.subjectaltname ? cert.subjectaltname.split(', ') : [],
              is_self_signed: cert.issuer?.CN === cert.subject?.CN,
              trust_status: trustStatus,
              raw_cert: cert // 调试用，包含完整证书信息
            };
            
            console.log('处理后的证书信息:', certInfo);
            resolve(certInfo);
          } else {
            resolve(null);
          }
        });
        
        req.on('error', (error) => {
          console.error('Certificate fetch error:', error);
          resolve({ error: error.message });
        });
        
        req.setTimeout(10000, () => {
          req.destroy();
          resolve({ error: '连接超时' });
        });
        
        req.end();
      });
    } catch (error) {
      console.error('Certificate function error:', error);
      return { error: error.message };
    }
  });  ipcMain.on('open-external', (_, url) => {
    shell.openExternal(url);
  });
    // 简易广告拦截相关API
  ipcMain.handle('open-adblock', () => {
    try {
      console.log('打开广告拦截状态页面');
      showAdblockStatus();
      return true;
    } catch (error) {
      console.error('打开广告拦截页面失败:', error);
      return false;
    }
  });
  
  // 获取简易广告拦截统计
  ipcMain.handle('get-adblock-stats', () => {
    return {
      blockedCount: adBlockStats.blockedCount,
      blockedToday: adBlockStats.blockedToday
    };
  });
  
  // 清空广告拦截统计
  ipcMain.handle('clear-adblock-stats', () => {
    try {
      adBlockStats.blockedCount = 0;
      adBlockStats.blockedToday = 0;
      console.log('广告拦截统计已清空');
      return true;
    } catch (error) {
      console.error('清空广告拦截统计失败:', error);
      return false;
    }
  });

  // 保存网桥配置到torrc文件
  ipcMain.handle('save-bridge-config', async () => {
    try {
      const config = store.store;
      await generateTorrcFile(config);
      return true;
    } catch (error) {
      console.error('保存网桥配置失败:', error);
      throw error;
    }
  });  // 自动配置内置网桥
  ipcMain.handle('auto-configure-bridge', async (_, bridgeType) => {
    try {
      let bridges = [];
      
      if (bridgeType === 'snowflake') {
        // Snowflake 本地配置
        bridges = [
          'snowflake 192.0.2.4:80 8838024498816A039FCBBAB14E6F40A0843051FA fingerprint=8838024498816A039FCBBAB14E6F40A0843051FA url=https://1098762253.rsc.cdn77.org/ fronts=www.cdn77.com,www.phpmyadmin.net ice=stun:stun.antisip.com:3478,stun:stun.epygi.com:3478,stun:stun.uls.co.za:3478,stun:stun.voipgate.com:3478,stun:stun.mixvoip.com:3478,stun:stun.nextcloud.com:3478,stun:stun.bethesda.net:3478,stun:stun.nextcloud.com:443 utls-imitate=hellorandomizedalpn',
          'snowflake 192.0.2.3:80 2B280B23E1107BB62ABFC40DDCC8824814F80A72 fingerprint=2B280B23E1107BB62ABFC40DDCC8824814F80A72 url=https://1098762253.rsc.cdn77.org/ fronts=www.cdn77.com,www.phpmyadmin.net ice=stun:stun.antisip.com:3478,stun:stun.epygi.com:3478,stun:stun.uls.co.za:3478,stun:stun.voipgate.com:3478,stun:stun.mixvoip.com:3478,stun:stun.nextcloud.com:3478,stun:stun.bethesda.net:3478,stun:stun.nextcloud.com:443 utls-imitate=hellorandomizedalpn'
        ];
      } else if (bridgeType === 'meek-azure') {
        // Meek 本地配置
        bridges = [
          'meek_lite 192.0.2.20:80 url=https://1314488750.rsc.cdn77.org front=www.phpmyadmin.net utls=HelloRandomizedALPN'
        ];
      }
      
      if (bridges.length > 0) {
        store.set('bridges', bridges);
        store.set('bridgeType', bridgeType);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('自动配置网桥失败:', error);
      throw error;
    }  });
  
  ipcMain.handle('reset-bridge-config', async (_, bridgeType) => {
    try {
      let bridges = [];
      
      if (bridgeType === 'snowflake') {
        // Snowflake 本地配置
        bridges = [
          'snowflake 192.0.2.4:80 8838024498816A039FCBBAB14E6F40A0843051FA fingerprint=8838024498816A039FCBBAB14E6F40A0843051FA url=https://snowflake-broker.torproject.net.global.prod.fastly.com/ fronts=foursquare.com,github.com ice=stun:stun.l.google.com:19302 utls-imitate=hellorandomizedalpn',
          'snowflake 192.0.2.3:80 2B280B23E1107BB62ABFC40DDCC8824814F80A72 fingerprint=2B280B23E1107BB62ABFC40DDCC8824814F80A72 url=https://snowflake-broker.torproject.net.global.prod.fastly.com/ fronts=foursquare.com,github.com ice=stun:stun.l.google.com:19302 utls-imitate=hellorandomizedalpn'
        ];
      } else if (bridgeType === 'meek-azure') {
        // Meek 本地配置
        bridges = [
          'meek_lite 192.0.2.20:80 url=https://meek.azureedge.net/ front=ajax.aspnetcdn.com'
        ];
      } else if (bridgeType === 'obfs4') {
        // 清空obfs4配置，用户需要手动添加
        bridges = [];
      }
      
      // 强制更新配置
      store.set('bridges', bridges);
      store.set('bridgeType', bridgeType);
      
      // 重新生成torrc
      generateTorrc();
      
      return { bridges, bridgeType };
    } catch (error) {
      console.error('重置网桥配置失败:', error);
      throw error;
    }
  });
    ipcMain.handle('clear-tor-log', () => {
    try {
      fs.writeFileSync(torLogFile, '');
      torLogs = [];
      return true;
    } catch (e) {
      console.error('清空Tor日志失败:', e);
      return false;
    }
  });
    // torrc文件编辑相关API
  ipcMain.handle('get-torrc-content', () => {
    try {
      const torrcPath = getUserDataPath('torrc');
      return fs.readFileSync(torrcPath, 'utf8');
    } catch (e) {
      console.error('读取torrc文件失败:', e);
      return '';
    }
  });
    ipcMain.handle('save-torrc-content', (_, content) => {
    try {
      const torrcPath = getUserDataPath('torrc');
      fs.writeFileSync(torrcPath, content, 'utf8');
      return true;
    } catch (e) {
      console.error('保存torrc文件失败:', e);
      return false;
    }
  });
  
  // 获取HTTP响应头
  ipcMain.handle('get-response-headers', async (_, url) => {
    try {
      const { net } = require('electron');
      const request = net.request(url);
      
      return new Promise((resolve, reject) => {
        request.on('response', (response) => {
          const headers = response.headers;
          const onionLocation = headers['onion-location'] || headers['Onion-Location'];
          resolve({
            status: response.statusCode,
            headers: headers,
            onionLocation: onionLocation
          });
        });
        
        request.on('error', (error) => {
          reject(error);
        });
        
        request.end();
      });
    } catch (error) {
      console.error('获取响应头失败:', error);
      return null;
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});