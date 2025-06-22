// Meow Anonyme 渲染进程主逻辑

// 全局变量
let tabs = [
  { id: 1, title: '新标签页', url: '', active: true, muted: false, pinned: false }  // 添加更多属性支持
];
let currentTabId = 1;
let tabIdCounter = 2;
let currentTheme = 'light';

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Renderer] 初始化开始');
    // 获取配置并应用主题
  try {
    const config = await window.electronAPI.getConfig();
    currentTheme = config.theme || 'light';
    applyTheme(currentTheme);
    updateConnectionStatus(config.torEnabled);    // 设置初始标签页的URL为用户设定的主页
    const homepage = config.homepage || 'https://www.bing.com/';
    tabs[0].url = homepage;
    
    // 应用用户设定的主题色
    if (config.accentColor) {
      document.documentElement.style.setProperty('--accent-primary', config.accentColor);
    }
  } catch (e) {
    console.error('获取配置失败:', e);
    tabs[0].url = 'https://www.bing.com/';  // fallback
  }

  // 绑定窗口控制
  bindWindowControls();
  
  // 绑定导航控件
  bindNavigationControls();
  
  // 绑定地址栏
  bindUrlBar();
  
  // 绑定工具栏按钮
  bindToolbarButtons();
    // 绑定标签页控件
  bindTabControls();
  
  // 绑定面板控件
  bindPanelControls();
  
  // 初始化webview
  initWebView();
  
  // 监听主进程事件
  bindMainProcessEvents();  // 渲染初始标签页
  renderTabs();
  
  // 使用延迟确保所有组件都已初始化
  setTimeout(() => {
    // 初始化webview内容
    updateWebview();
    updateUrlInput();
  }, 200);
  // 监听主进程发送的主题变更事件
  window.electronAPI.onThemeChange((themeData) => {
    console.log('[Theme] 接收到主题变更:', themeData);
    currentTheme = themeData.theme;
    applyTheme(currentTheme);
    if (themeData.accentColor) {
      document.documentElement.style.setProperty('--accent-primary', themeData.accentColor);
    }
  });

  // 监听来自设置窗口的消息
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'show-log') {
      toggleLogPanel();
    } else if (event.data && event.data.type === 'theme-change') {
      currentTheme = event.data.theme;
      applyTheme(currentTheme);
    } else if (event.data && event.data.type === 'color-change') {
      document.documentElement.style.setProperty('--accent-primary', event.data.color);
    }
  });
  
  console.log('[Renderer] 初始化完成');
});

// 窗口控制
function bindWindowControls() {
  document.getElementById('minimize-btn').addEventListener('click', () => {
    window.electronAPI.windowAction('minimize');
  });
  
  document.getElementById('maximize-btn').addEventListener('click', () => {
    window.electronAPI.windowAction('maximize');
  });
  
  document.getElementById('close-btn').addEventListener('click', () => {
    window.electronAPI.windowAction('close');
  });
}

// 导航控件
function bindNavigationControls() {
  const webview = document.getElementById('webview');
  
  document.getElementById('back-btn').addEventListener('click', () => {
    if (webview && typeof webview.goBack === 'function') {
      webview.goBack();
    }
  });
  
  document.getElementById('forward-btn').addEventListener('click', () => {
    if (webview && typeof webview.goForward === 'function') {
      webview.goForward();
    }
  });
  
  document.getElementById('refresh-btn').addEventListener('click', () => {
    if (webview && typeof webview.reload === 'function') {
      webview.reload();
    }
  });
    document.getElementById('home-btn').addEventListener('click', async () => {
    const config = await window.electronAPI.getConfig();
    const homepage = config.homepage || 'https://www.bing.com/';
    navigateTo(homepage);
  });
}

// 地址栏
function bindUrlBar() {
  const urlInput = document.getElementById('url-input');
  const bookmarkBtn = document.getElementById('bookmark-btn');
  const securityIndicator = document.querySelector('.security-indicator');
  
  urlInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      const query = urlInput.value.trim();
      if (query) {
        if (query.includes('.') && !query.includes(' ')) {
          // 看起来像URL
          navigateTo(query.startsWith('http') ? query : 'https://' + query);
        } else {
          // 当作搜索，使用用户设定的搜索引擎
          const searchUrl = await getSearchUrl(query);
          navigateTo(searchUrl);
        }
      }
    }
  });
  
  bookmarkBtn.addEventListener('click', toggleBookmark);
  securityIndicator.addEventListener('click', async () => {
    const tab = tabs.find(t => t.active);
    if (tab && tab.url) {
      try {
        const cert = await window.electronAPI.getCertificate(tab.url);
        console.log('获取到的证书信息:', cert);
        
        if (cert && !cert.error) {
          // 构建详细的证书信息显示
          let message = '🔒 网站证书信息\n\n';
          
          // 主题信息
          if (cert.subject) {
            message += '📋 证书主体：\n';
            message += `  通用名称: ${cert.subject.CN || '未知'}\n`;
            message += `  组织: ${cert.subject.O || '未知'}\n`;
            message += `  国家: ${cert.subject.C || '未知'}\n\n`;
          }
          
          // 颁发者信息
          if (cert.issuer) {
            message += '🏢 颁发者：\n';
            message += `  颁发机构: ${cert.issuer.CN || cert.issuer.O || '未知'}\n`;
            message += `  组织: ${cert.issuer.O || '未知'}\n`;
            message += `  国家: ${cert.issuer.C || '未知'}\n\n`;
          }
          
          // 有效期信息
          if (cert.validity) {
            message += '📅 有效期：\n';
            message += `  生效时间: ${cert.validity.valid_from_formatted || '未知'}\n`;
            message += `  到期时间: ${cert.validity.valid_to_formatted || '未知'}\n`;
            message += `  剩余天数: ${cert.validity.days_remaining || '未知'} 天\n`;
            message += `  状态: ${cert.validity.status || cert.trust_status || '未知'}\n\n`;
          }
          
          // 指纹信息
          if (cert.fingerprints) {
            message += '🔐 指纹：\n';
            message += `  SHA-1: ${cert.fingerprints.sha1 || '未知'}\n`;
            message += `  SHA-256: ${cert.fingerprints.sha256 || '未知'}\n\n`;
          }
          
          // 连接信息
          if (cert.connection) {
            message += '🌐 连接信息：\n';
            message += `  协议: ${cert.connection.protocol || '未知'}\n`;
            message += `  加密套件: ${cert.connection.cipher_suite || '未知'}\n\n`;
          }
          
          // SAN 信息
          if (cert.san && cert.san.length > 0) {
            message += '🔗 备用名称：\n';
            cert.san.forEach(name => {
              message += `  ${name}\n`;
            });
            message += '\n';
          }
          
          // 其他信息
          if (cert.details) {
            message += '📋 其他信息：\n';
            message += `  序列号: ${cert.details.serial_number || '未知'}\n`;
            message += `  版本: ${cert.details.version || '未知'}\n`;
            message += `  签名算法: ${cert.details.signature_algorithm || '未知'}\n`;
            message += `  公钥算法: ${cert.details.public_key_algorithm || '未知'}\n`;
            message += `  公钥大小: ${cert.details.public_key_size || '未知'} 位\n`;
          }
          
          if (cert.is_self_signed) {
            message += '\n⚠️ 这是一个自签名证书';
          }
          
          alert(message);
        } else {
          alert('❌ 无法获取证书信息\n\n' + (cert?.error || '此网站可能未提供有效的SSL证书'));
        }
      } catch (error) {
        console.error('获取证书信息失败:', error);
        alert('❌ 获取证书信息失败\n\n请检查网络连接或网站是否支持HTTPS');
      }
    } else {
      alert('❌ 请先访问一个网站');
    }
  });
}

// 获取搜索URL
async function getSearchUrl(query) {
  try {
    const config = await window.electronAPI.getConfig();
    const searchEngine = config.searchEngine || 'bing';
    const encodedQuery = encodeURIComponent(query);
    
    const searchEngines = {
      'bing': `https://www.bing.com/search?q=${encodedQuery}`,
      'google': `https://www.google.com/search?q=${encodedQuery}`,
      'duckduckgo': `https://duckduckgo.com/?q=${encodedQuery}`,
      'startpage': `https://www.startpage.com/sp/search?query=${encodedQuery}`,
      'searx': `https://searx.org/search?q=${encodedQuery}`,
      'custom': config.customSearchUrl ? config.customSearchUrl.replace('%s', encodedQuery) : `https://www.bing.com/search?q=${encodedQuery}`
    };
    
    return searchEngines[searchEngine] || searchEngines.bing;
  } catch (e) {
    console.error('获取搜索配置失败:', e);
    return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  }
}

// 工具栏按钮
function bindToolbarButtons() {
  document.getElementById('download-btn').addEventListener('click', async () => {
    const tab = tabs.find(t => t.active);
    if (tab) {
      await window.electronAPI.downloadPage(tab.url);
      showNotification('页面下载已开始', 'success');
    }
  });
  
  document.getElementById('screenshot-btn').addEventListener('click', async () => {
    const filePath = await window.electronAPI.screenshot();
    if (filePath) {
      showNotification(`截图已保存到：${filePath}`, 'success');
    } else {
      showNotification('截图失败', 'error');
    }
  });
  
  document.getElementById('show-bookmarks-btn').addEventListener('click', toggleBookmarkPanel);
  
  document.getElementById('settings-btn').addEventListener('click', () => {
    window.electronAPI.openSettings();
  });
    document.getElementById('show-log-btn').addEventListener('click', () => {
    window.electronAPI.openTorLog();
  });
  
  // 广告拦截按钮
  document.getElementById('adblock-btn').addEventListener('click', () => {
    window.electronAPI.openAdblock();
  });
}

// 标签页控件
function bindTabControls() {
  const tabsContainer = document.querySelector('.tabs-container');
  const newTabBtn = document.getElementById('new-tab-btn');
  
  // 标签页事件委托
  tabsContainer.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    
    const tabId = parseInt(tab.dataset.id);
    
    if (e.target.closest('.tab-close')) {
      closeTab(tabId);
    } else {
      switchTab(tabId);
    }
  });
  
  // 标签页右键菜单
  tabsContainer.addEventListener('contextmenu', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    
    e.preventDefault();
    showTabContextMenu(e.clientX, e.clientY, parseInt(tab.dataset.id));
  });
  
  newTabBtn.addEventListener('click', () => {
    addNewTab();
  });
  
  // 绑定右键菜单项
  bindTabContextMenu();
}

// 标签页右键菜单
let currentContextTabId = null;

function bindTabContextMenu() {
  const contextMenu = document.getElementById('tab-context-menu');
  
  // 绑定菜单项事件
  document.getElementById('duplicate-tab').addEventListener('click', () => {
    duplicateTab(currentContextTabId);
    hideTabContextMenu();
  });
  
  document.getElementById('mute-tab').addEventListener('click', () => {
    toggleTabMute(currentContextTabId);
    hideTabContextMenu();
  });
  
  document.getElementById('reload-tab').addEventListener('click', () => {
    reloadTab(currentContextTabId);
    hideTabContextMenu();
  });
  
  document.getElementById('pin-tab').addEventListener('click', () => {
    toggleTabPin(currentContextTabId);
    hideTabContextMenu();
  });
  
  document.getElementById('close-tab-menu').addEventListener('click', () => {
    closeTab(currentContextTabId);
    hideTabContextMenu();
  });
  
  document.getElementById('close-other-tabs').addEventListener('click', () => {
    closeOtherTabs(currentContextTabId);
    hideTabContextMenu();
  });
  
  // 点击其他地方隐藏菜单
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
      hideTabContextMenu();
    }
  });
}

function showTabContextMenu(x, y, tabId) {
  const contextMenu = document.getElementById('tab-context-menu');
  const tab = tabs.find(t => t.id === tabId);
  
  if (!tab) return;
  
  currentContextTabId = tabId;
  
  // 更新菜单项状态
  const muteItem = document.getElementById('mute-tab');
  const pinItem = document.getElementById('pin-tab');
  
  muteItem.innerHTML = tab.muted ? 
    '<i class="fa-solid fa-volume-high"></i> 取消静音' : 
    '<i class="fa-solid fa-volume-mute"></i> 静音标签页';
    
  pinItem.innerHTML = tab.pinned ? 
    '<i class="fa-solid fa-thumbtack"></i> 取消固定' : 
    '<i class="fa-solid fa-thumbtack"></i> 固定标签页';
  
  // 设置菜单位置
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.display = 'block';
  
  // 确保菜单不超出屏幕
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (x - rect.width) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (y - rect.height) + 'px';
  }
}

function hideTabContextMenu() {
  document.getElementById('tab-context-menu').style.display = 'none';
  currentContextTabId = null;
}

function duplicateTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    addNewTab(tab.url);
  }
}

function toggleTabMute(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    tab.muted = !tab.muted;
    // 这里可以添加实际的静音逻辑
    showNotification(tab.muted ? '标签页已静音' : '标签页已取消静音');
    renderTabs();
  }
}

function reloadTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (tab && tab.active) {
    const webview = document.getElementById('webview');
    if (webview && typeof webview.reload === 'function') {
      webview.reload();
    }
  }
}

function toggleTabPin(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    tab.pinned = !tab.pinned;
    showNotification(tab.pinned ? '标签页已固定' : '标签页已取消固定');
    renderTabs();
  }
}

function closeOtherTabs(keepTabId) {
  tabs = tabs.filter(tab => tab.id === keepTabId);
  
  // 确保保留的标签页是激活的
  const keepTab = tabs.find(t => t.id === keepTabId);
  if (keepTab) {
    keepTab.active = true;
    currentTabId = keepTabId;
  }
  
  renderTabs();
  updateWebview();
  showNotification('已关闭其他标签页');
}

// 面板控件
function bindPanelControls() {
  // 日志面板
  const logPanel = document.getElementById('log-panel');
  const closeLogBtn = document.getElementById('close-log-btn');
  
  closeLogBtn.addEventListener('click', () => {
    logPanel.style.display = 'none';
  });
  
  // 收藏夹面板
  const bookmarkPanel = document.getElementById('bookmark-panel');
  const closeBookmarkBtn = document.getElementById('close-bookmark-panel');
  const exportBtn = document.getElementById('export-bookmarks-btn');
  const importBtn = document.getElementById('import-bookmarks-btn');
  
  closeBookmarkBtn.addEventListener('click', () => {
    bookmarkPanel.style.display = 'none';
  });
  
  exportBtn.addEventListener('click', exportBookmarks);
  importBtn.addEventListener('click', importBookmarks);
  
  // 点击外部关闭面板
  document.addEventListener('click', (e) => {
    if (!bookmarkPanel.contains(e.target) && 
        !document.getElementById('show-bookmarks-btn').contains(e.target)) {
      bookmarkPanel.style.display = 'none';
    }
    
    if (!logPanel.contains(e.target) && 
        !document.getElementById('show-log-btn').contains(e.target)) {
      logPanel.style.display = 'none';
    }
  });
}

// 监听主进程事件
function bindMainProcessEvents() {
  // Tor日志
  window.electronAPI.onTorLog((log) => {
    const logContent = document.getElementById('log-content');
    const logEntry = document.createElement('div');
    logEntry.textContent = log;
    logContent.appendChild(logEntry);
    logContent.scrollTop = logContent.scrollHeight;
  });
  
  // Tor状态变化
  window.electronAPI.onTorStatus((status) => {
    updateConnectionStatus(status.connected);
    updateTorIndicator(status.connected);
  });
  
  // 新标签页请求
  window.electronAPI.onOpenNewTab((url) => {
    addNewTab(url);
  });
}

// WebView初始化
function initWebView() {
  const webview = document.getElementById('webview');
  
  if (!webview) {
    console.error('WebView元素未找到');
    return;
  }
  
  // 等待webview准备就绪
  const waitForWebview = () => {
    if (webview && typeof webview.addEventListener === 'function') {
      console.log('[WebView] 开始绑定事件');      webview.addEventListener('dom-ready', () => {
        console.log('[WebView] DOM准备就绪');
        webviewReady = true;
      });
      
      webview.addEventListener('did-start-loading', () => {
        console.log('[WebView] 开始加载');
        updateLoadingState(true);
      });
        webview.addEventListener('did-stop-loading', () => {
        console.log('[WebView] 加载完成');
        updateLoadingState(false);
        updatePageInfo();
        checkOnionLocation();
      });
      
      webview.addEventListener('did-navigate', (e) => {
        console.log('[WebView] 导航到:', e.url);
        const tab = tabs.find(t => t.active);
        if (tab && tab.url !== e.url) {
          tab.url = e.url;
          updateUrlInput();
        }
      });
      
      webview.addEventListener('page-title-updated', (e) => {
        console.log('[WebView] 标题更新:', e.title);
        const tab = tabs.find(t => t.active);
        if (tab && tab.title !== e.title) {
          tab.title = e.title;
          renderTabs();
        }
      });
        webview.addEventListener('did-fail-load', (e) => {
        if (e.errorCode !== -3) { // 忽略用户取消
          // 忽略广告拦截导致的错误，避免不必要的弹窗
          if (e.errorDescription && e.errorDescription.includes('ERR_BLOCKED_BY_RESPONSE')) {
            console.log('[WebView] 广告拦截生效:', e.validatedURL);
            return;
          }
          console.error('[WebView] 加载失败:', e);
          showNotification(`页面加载失败: ${e.errorDescription}`, 'error');
        }
      });
      
      // 处理新窗口请求
      webview.addEventListener('new-window', (e) => {
        e.preventDefault();
        addNewTab(e.url);
      });
      
    } else {
      console.log('[WebView] 等待webview就绪...');
      setTimeout(waitForWebview, 100);
    }
  };
  
  waitForWebview();
}

// 导航功能
function navigateTo(url) {
  const tab = tabs.find(t => t.active);
  if (!tab || !url) return;
  
  // 确保URL格式正确
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
    tab.url = url;
  updateWebview();
  updateUrlInput();
}

// 标签页管理
function renderTabs() {
  const tabsContainer = document.querySelector('.tabs-container');
  if (!tabsContainer) return;
  
  tabsContainer.innerHTML = '';
  
  tabs.forEach(tab => {
    const tabElement = document.createElement('div');
    let className = 'tab';
    if (tab.active) className += ' active';
    if (tab.pinned) className += ' pinned';
    if (tab.muted) className += ' muted';
    
    tabElement.className = className;
    tabElement.dataset.id = tab.id;
    
    if (tab.pinned) {
      tabElement.innerHTML = `
        <i class="fa-solid fa-thumbtack" title="${tab.title}"></i>
      `;
    } else {
      tabElement.innerHTML = `
        <span class="tab-title" title="${tab.title}">${tab.title}</span>
        <button class="tab-close"><i class="fa-solid fa-xmark"></i></button>
      `;
    }
    
    tabsContainer.appendChild(tabElement);
  });
}

async function addNewTab(url) {
  // 如果没有指定URL，使用用户设定的主页
  if (!url) {
    try {
      const config = await window.electronAPI.getConfig();
      url = config.homepage || 'https://www.bing.com/';
    } catch (e) {
      url = 'https://www.bing.com/';
    }
  }
  
  // 取消所有标签页的激活状态
  tabs.forEach(tab => tab.active = false);
    // 创建新标签页
  const newTab = {
    id: tabIdCounter++,
    title: '新标签页',
    url: url,
    active: true,
    muted: false,
    pinned: false
  };
  
  tabs.push(newTab);
  currentTabId = newTab.id;
  
  renderTabs();
  updateWebview();
  updateUrlInput();
}

function switchTab(id) {
  tabs.forEach(tab => tab.active = (tab.id === id));
  currentTabId = id;
  
  renderTabs();
  updateWebview();
  updateUrlInput();
}

function closeTab(id) {
  if (tabs.length <= 1) {
    showNotification('最后一个标签页无法关闭', 'warning');
    return;
  }
  
  const tabIndex = tabs.findIndex(t => t.id === id);
  const wasActive = tabs[tabIndex].active;
  
  tabs.splice(tabIndex, 1);
  
  if (wasActive) {
    // 如果关闭的是活动标签，激活相邻标签
    const newActiveIndex = Math.max(0, tabIndex - 1);
    switchTab(tabs[newActiveIndex].id);
  } else {
    renderTabs();
  }
}

// WebView更新
let webviewReady = false;
let pendingUrl = null;

function updateWebview() {
  const tab = tabs.find(t => t.active);
  const webview = document.getElementById('webview');
  
  if (!webview || !tab) {
    console.error('WebView或当前标签未找到');
    return;
  }
  
  console.log('[updateWebview] 切换到:', tab.url);
  
  // 避免重复设置相同URL
  const currentSrc = webview.src || webview.getAttribute('src');
  if (currentSrc === tab.url) {
    console.log('[updateWebview] URL相同，跳过更新');
    return;
  }
    // 检查webview是否存在有效的URL
  if (!tab.url) {
    console.log('[updateWebview] URL为空，跳过更新');
    return;
  }
  
  // 简单的延迟加载，确保 webview 完全准备就绪
  const loadWithDelay = () => {
    try {
      if (typeof webview.loadURL === 'function') {
        console.log('[updateWebview] 使用loadURL加载:', tab.url);
        webview.loadURL(tab.url);
      } else {
        console.log('[updateWebview] loadURL不可用，使用src属性:', tab.url);
        webview.src = tab.url;
      }
    } catch (e) {
      console.log('[updateWebview] loadURL失败，回退到src属性:', e.message);
      webview.src = tab.url;
    }
  };
  
  // 如果 webview 已经准备就绪，立即加载；否则稍微延迟
  if (webviewReady) {
    loadWithDelay();
  } else {
    setTimeout(loadWithDelay, 100);
  }
}

function updateUrlInput() {
  const tab = tabs.find(t => t.active);
  const urlInput = document.getElementById('url-input');
  
  if (tab && urlInput) {
    urlInput.value = tab.url;
  }
}

function updateLoadingState(loading) {
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    if (loading) {
      refreshBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      refreshBtn.title = '停止';
    } else {
      refreshBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
      refreshBtn.title = '刷新';
    }
  }
}

function updatePageInfo() {
  const webview = document.getElementById('webview');
  if (!webview || typeof webview.getURL !== 'function') return;
  
  try {
    const url = webview.getURL();
    const securityIndicator = document.querySelector('.security-indicator');
    
    if (securityIndicator) {
      if (url.startsWith('https://')) {
        securityIndicator.innerHTML = '<i class="fa-solid fa-lock"></i>';
        securityIndicator.style.color = 'var(--accent-primary)';
      } else if (url.startsWith('http://')) {
        securityIndicator.innerHTML = '<i class="fa-solid fa-lock-open"></i>';
        securityIndicator.style.color = 'var(--accent-secondary)';
      } else {
        securityIndicator.innerHTML = '<i class="fa-solid fa-globe"></i>';
        securityIndicator.style.color = 'var(--text-secondary)';
      }
    }
    
    // 更新标签页信息
    const tab = tabs.find(t => t.active);
    if (tab) {
      tab.url = url;
      updateUrlInput();
    }  } catch (e) {
    console.error('更新页面信息失败:', e);
  }
}

// 检查Onion-Location头
async function checkOnionLocation() {
  const webview = document.getElementById('webview');
  if (!webview || typeof webview.getURL !== 'function') return;
  
  try {
    const currentUrl = webview.getURL();
    
    // 只在HTTPS页面检查Onion-Location
    if (!currentUrl.startsWith('https://')) return;
    
    // 检查当前是否已连接Tor
    const config = await window.electronAPI.getConfig();
    if (!config.torEnabled) return;
    
    let onionUrl = null;
    
    // 1. 通过注入脚本检查meta标签
    const script = `
      (function() {
        try {
          const metaOnion = document.querySelector('meta[http-equiv="onion-location" i]');
          if (metaOnion && metaOnion.content) {
            return metaOnion.content;
          }
          return null;
        } catch (e) {
          return null;
        }
      })();
    `;
    
    webview.executeJavaScript(script, async (metaResult) => {
      if (metaResult && metaResult.startsWith('http')) {
        onionUrl = metaResult;
        showOnionLocationNotification(currentUrl, onionUrl);
      } else {
        // 2. 如果meta标签没有找到，尝试获取HTTP响应头
        try {
          const responseInfo = await window.electronAPI.getResponseHeaders(currentUrl);
          if (responseInfo && responseInfo.onionLocation) {
            onionUrl = Array.isArray(responseInfo.onionLocation) 
              ? responseInfo.onionLocation[0] 
              : responseInfo.onionLocation;
            
            if (onionUrl && onionUrl.startsWith('http')) {
              showOnionLocationNotification(currentUrl, onionUrl);
            }
          }
        } catch (e) {
          console.log('获取HTTP响应头失败:', e);
        }
      }
    });
    
  } catch (e) {
    console.error('检查Onion-Location失败:', e);
  }
}

// 显示Onion域名切换提醒
function showOnionLocationNotification(currentUrl, onionUrl) {
  // 避免重复显示通知
  if (document.querySelector('.onion-notification')) return;
  
  const notification = document.createElement('div');
  notification.className = 'onion-notification';
  notification.innerHTML = `
    <div class="onion-content">
      <div class="onion-icon">🧅</div>
      <div class="onion-text">
        <h4>检测到Onion镜像站点</h4>
        <p>此网站提供了更安全的.onion域名访问方式</p>
        <small>${onionUrl}</small>
      </div>
      <div class="onion-actions">
        <button class="onion-btn onion-switch">切换访问</button>
        <button class="onion-btn onion-dismiss">忽略</button>
      </div>
    </div>
  `;
  
  // 添加样式
  notification.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: 0 8px 25px var(--shadow);
    z-index: 10000;
    max-width: 350px;
    animation: slideIn 0.3s ease-out;
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    .onion-content {
      padding: 16px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    
    .onion-icon {
      font-size: 24px;
      flex-shrink: 0;
    }
    
    .onion-text h4 {
      margin: 0 0 4px 0;
      color: var(--text-primary);
      font-size: 14px;
      font-weight: 600;
    }
    
    .onion-text p {
      margin: 0 0 8px 0;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.4;
    }
    
    .onion-text small {
      color: var(--text-secondary);
      font-size: 11px;
      word-break: break-all;
    }
    
    .onion-actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }
    
    .onion-btn {
      padding: 6px 12px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .onion-switch {
      background: var(--accent-primary);
      color: white;
    }
    
    .onion-switch:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(78, 205, 196, 0.3);
    }
    
    .onion-dismiss {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
    }
    
    .onion-dismiss:hover {
      background: var(--border-color);
    }
    
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(notification);
  
  // 绑定事件
  notification.querySelector('.onion-switch').addEventListener('click', () => {
    navigateTo(onionUrl);
    notification.remove();
    style.remove();
  });
  
  notification.querySelector('.onion-dismiss').addEventListener('click', () => {
    notification.remove();
    style.remove();
  });
    // 自动隐藏
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
      style.remove();
    }
  }, 10000);
}

// 主题切换
function applyTheme(theme) {
  const body = document.body;
  body.setAttribute('data-theme', theme);
}

// 连接状态更新
function updateConnectionStatus(torEnabled) {
  const statusText = document.getElementById('connection-status');
  if (statusText) {
    statusText.textContent = torEnabled ? 'Tor已连接' : '系统代理';
  }
}

function updateTorIndicator(connected) {
  const indicator = document.getElementById('tor-indicator');
  if (indicator) {
    if (connected) {
      indicator.classList.add('connected');
    } else {
      indicator.classList.remove('connected');
    }
  }
}

// 收藏夹功能
async function toggleBookmark() {
  const tab = tabs.find(t => t.active);
  if (!tab) return;
  
  const bookmarks = await window.electronAPI.getBookmarks();
  const exists = bookmarks.some(b => b.url === tab.url);
  
  if (exists) {
    await window.electronAPI.removeBookmark(tab.url);
    showNotification('已取消收藏', 'info');
  } else {
    await window.electronAPI.addBookmark({ title: tab.title, url: tab.url });
    showNotification('收藏成功', 'success');
  }
  
  updateBookmarkButton();
}

async function updateBookmarkButton() {
  const tab = tabs.find(t => t.active);
  const bookmarkBtn = document.getElementById('bookmark-btn');
  
  if (!tab || !bookmarkBtn) return;
  
  const bookmarks = await window.electronAPI.getBookmarks();
  const isBookmarked = bookmarks.some(b => b.url === tab.url);
  
  if (isBookmarked) {
    bookmarkBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
    bookmarkBtn.style.color = 'var(--accent-secondary)';
  } else {
    bookmarkBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
    bookmarkBtn.style.color = 'var(--text-secondary)';
  }
}

function toggleBookmarkPanel() {
  const panel = document.getElementById('bookmark-panel');
  if (panel.style.display === 'flex') {
    panel.style.display = 'none';
  } else {
    renderBookmarkList();
    panel.style.display = 'flex';
  }
}

async function renderBookmarkList() {
  const bookmarkList = document.getElementById('bookmark-list');
  const bookmarks = await window.electronAPI.getBookmarks();
  
  if (!bookmarks.length) {
    bookmarkList.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
        <i class="fa-solid fa-bookmark" style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
        <p>暂无收藏</p>
        <p style="font-size: 12px;">收藏你喜欢的网站吧！</p>
      </div>
    `;
    return;
  }
  
  bookmarkList.innerHTML = '';
  
  bookmarks.forEach((bookmark, index) => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    item.innerHTML = `
      <div style="flex: 1; min-width: 0;">
        <div class="bookmark-title" title="${bookmark.title}">${bookmark.title}</div>
        <div class="bookmark-url" title="${bookmark.url}">${bookmark.url}</div>
      </div>
      <div class="bookmark-actions">
        <button onclick="openBookmark(${index})" title="打开">
          <i class="fa-solid fa-external-link-alt"></i>
        </button>
        <button onclick="deleteBookmark(${index})" title="删除" style="background: var(--accent-secondary);">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;
    
    bookmarkList.appendChild(item);
  });
}

async function openBookmark(index) {
  const bookmarks = await window.electronAPI.getBookmarks();
  if (bookmarks[index]) {
    addNewTab(bookmarks[index].url);
    document.getElementById('bookmark-panel').style.display = 'none';
  }
}

async function deleteBookmark(index) {
  const bookmarks = await window.electronAPI.getBookmarks();
  if (bookmarks[index]) {
    await window.electronAPI.removeBookmark(bookmarks[index].url);
    renderBookmarkList();
    updateBookmarkButton();
  }
}

async function exportBookmarks() {
  const bookmarks = await window.electronAPI.getBookmarks();
  const csv = bookmarksToCSV(bookmarks);
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  
  link.href = url;
  link.download = 'meow_bookmarks.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  showNotification('收藏夹导出成功', 'success');
}

function importBookmarks() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const bookmarks = parseCSV(text);
      
      for (const bookmark of bookmarks) {
        await window.electronAPI.addBookmark(bookmark);
      }
      
      renderBookmarkList();
      showNotification(`成功导入 ${bookmarks.length} 个收藏`, 'success');
    } catch (e) {
      showNotification('导入失败：文件格式错误', 'error');
    }
  };
  
  input.click();
}

function bookmarksToCSV(bookmarks) {
  let csv = 'title,url\n';
  bookmarks.forEach(b => {
    const title = (b.title || '').replace(/"/g, '""');
    const url = (b.url || '').replace(/"/g, '""');
    csv += `"${title}","${url}"\n`;
  });
  return csv;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  
  const bookmarks = [];
  for (let i = 1; i < lines.length; i++) {
    const match = lines[i].match(/^"(.*)","(.*)"$/);
    if (match) {
      bookmarks.push({
        title: match[1].replace(/""/g, '"') || match[2],
        url: match[2].replace(/""/g, '"')
      });
    }
  }
  return bookmarks;
}

// 日志面板
function toggleLogPanel() {
  const panel = document.getElementById('log-panel');
  if (panel.style.display === 'flex') {
    panel.style.display = 'none';
  } else {
    refreshTorLog();
    panel.style.display = 'flex';
  }
}

async function refreshTorLog() {
  const logContent = document.getElementById('log-content');
  try {
    const logs = await window.electronAPI.getTorLogs();
    logContent.textContent = logs;
    logContent.scrollTop = logContent.scrollHeight;
  } catch (e) {
    logContent.textContent = '无法获取日志信息';
  }
}

// 通知系统
function showNotification(message, type = 'info') {
  // 创建通知元素
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    z-index: 10000;
    opacity: 0;
    transform: translateX(100%);
    transition: all 0.3s ease;
    max-width: 300px;
    word-wrap: break-word;
  `;
  
  // 根据类型设置样式
  switch (type) {
    case 'success':
      notification.style.backgroundColor = '#28a745';
      break;
    case 'error':
      notification.style.backgroundColor = '#dc3545';
      break;
    case 'warning':
      notification.style.backgroundColor = '#ffc107';
      notification.style.color = '#212529';
      break;
    default:
      notification.style.backgroundColor = '#17a2b8';
  }
  
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // 显示动画
  setTimeout(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateX(0)';
  }, 100);
  
  // 自动消失
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// 全局函数暴露（供HTML中的onclick使用）
window.openBookmark = openBookmark;
window.deleteBookmark = deleteBookmark;
