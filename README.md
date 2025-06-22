# Meow Anonyme

![Logo](assets/icons/icon.ico)

一个基于Electron的匿名浏览器，集成了隐私保护、广告拦截和Tor网络支持。

## ✨ 主要特性

### 🔒 隐私保护
- **User-Agent 最小化**：三级隐私保护（低、中、高），有效防止浏览器指纹识别
- **浏览器指纹伪装**：动态伪装Navigator和Screen属性
- **无痕浏览**：自动清理浏览数据，不留痕迹

### 🛡️ 广告拦截
- **简易广告拦截**：基于域名和关键词的智能拦截
- **实时统计**：显示拦截数量和今日拦截统计
- **错误处理优化**：对ERR_BLOCKED_BY_RESPONSE错误进行静默处理

### 🌐 Tor 网络支持
- **内置Tor客户端**：支持SOCKS5代理和网桥
- **多种网桥类型**：支持obfs4、meek-lite、snowflake等
- **前置代理支持**：兼容Clash、V2Ray等代理工具

### 🎨 现代界面
- **无边框设计**：现代化的用户界面
- **深色/浅色主题**：支持主题切换和自定义颜色
- **本地资源**：使用本地Font Awesome图标，无需联网

## 📦 安装使用

### 开发环境
```bash
# 克隆仓库
git clone https://github.com/B5-Software/MeowAnonyme.git
cd MeowAnonyme

# 安装依赖
npm install

# 启动开发模式
npm start
```

### 打包发布
```bash
# Windows
npm run build-win

# macOS
npm run build-mac

# Linux
npm run build-linux
```

## 🔧 配置说明

### 广告拦截
基于以下策略进行拦截：
- 知名广告域名（Google Ads、Facebook、百度推广等）
- URL关键词检测（/ads/、/ad/、advertisement等）
- 实时统计和状态显示

### Tor 配置
- 支持自定义网桥配置
- 支持前置代理（HTTP/HTTPS）
- 自动生成torrc配置文件

## 📁 项目结构

```
MeowAnonyme/
├── src/
│   ├── main.js          # 主进程
│   ├── preload.js       # 预加载脚本
│   ├── renderer.js      # 渲染进程
│   └── utils.js         # 工具函数
├── views/
│   ├── index.html       # 主界面
│   ├── settings.html    # 设置页面
│   ├── tor-log.html     # Tor日志页面
│   └── adblock-status.html # 广告拦截状态
├── styles/
│   ├── main.css         # 主样式
│   ├── settings.css     # 设置页面样式
│   └── dark-theme.css   # 深色主题
├── assets/
│   ├── fonts/           # 本地字体文件
│   └── icons/           # 应用图标
└── test-*.html          # 测试页面
```

## 🧪 功能测试

项目包含多个测试页面：

- `test-privacy.html` - 隐私保护功能测试
- `test-adblock.html` - 广告拦截功能测试
- `test-adblock-functions.js` - 广告拦截功能脚本测试

## 📋 技术栈

- **Electron** - 跨平台桌面应用框架
- **Node.js** - 后端运行时
- **Tor** - 匿名网络代理
- **Electron Store** - 应用配置存储
- **Font Awesome** - 图标字体库

## 🛠️ 开发说明

### 核心功能模块

1. **隐私保护** (`src/main.js`)
   - User-Agent管理
   - 浏览器指纹伪装
   - webview隐私设置

2. **广告拦截** (`src/main.js`)
   - webRequest拦截
   - 统计数据管理
   - 状态界面更新

3. **Tor集成** (`src/main.js`)
   - 进程管理
   - 配置文件生成
   - 日志处理

### 打包注意事项

- Tor二进制文件通过extraResources打包
- 视图文件打包在app.asar中
- 配置文件存储在用户数据目录

## 📄 许可证

此项目遵循 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📧 联系方式

- 作者：B5-Software
- 邮箱：b5-software@autistici.org
- 项目主页：https://github.com/B5-Software/MeowAnonyme

---

**注意**：本软件仅用于合法的隐私保护目的，请遵守当地法律法规。
