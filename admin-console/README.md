# Admin Console

YSbot 插件管理后台，提供插件列表、详情、启停、重载、清理数据、安装、卸载、更新、运行状态和日志管理。

后台还支持：

- 插件声明 `admin-console.json` 后自动出现在参数配置区。
- 插件声明 `pages` 后在特殊页面区通过 iframe 打开。
- 全局主题令牌通过 `/api/admin-console/design-tokens.css` 提供。
- 后台 UI 使用 Web Components：`ysbot-button`、`ysbot-badge`、`ysbot-modal`、`ysbot-toast`。
- 外观页支持预设主题、深色主题、自定义颜色和字体。
- 特殊页面以 sandbox iframe 加载，页面内使用 `window.__YSBOT_ADMIN_TOKEN__` 调用受保护 API。
- 特殊页面还会获得 `window.__YSBOT_ADMIN_THEME__` 和设计令牌 CSS。
- 插件可通过 `ctx.pluginConfig` 读写自己的配置和密钥。
- admin-console 自身显示为受保护插件，不允许禁用、清理、卸载或自更新。

## 使用

以下命令需要在 `ysbot-plugins` 插件工作区执行：

```powershell
node tools/ysbot.js validate admin-console
node tools/ysbot.js test admin-console
node tools/ysbot.js pack admin-console
node tools/ysbot.js deploy admin-console --mode plg
```

后台页面：`http://127.0.0.1:5178/api/admin-console/ui`

默认登录凭据来自 Core 配置，未修改时是 `admin` / `12345678`。
