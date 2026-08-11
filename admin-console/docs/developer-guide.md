# Admin Console 插件兼容开发说明

## 目标

本文档说明插件如何接入 `admin-console`，获得：

- 参数配置区自动表单
- 特殊页面导航和 iframe 嵌入
- 全局主题和个性化外观继承
- 插件管理后台的安全边界

## 前置要求

- Core 版本：`@xiaokuc/ysbot >= 0.2.2`
- 插件提供 `plugin.json` 和 `index.js`
- 插件根目录可选提供 `admin-console.json`

## 后台扩展入口

插件根目录增加 `admin-console.json`：

```json
{
  "version": 1,
  "config": {
    "title": "插件配置",
    "groups": [],
    "schema": {
      "type": "object",
      "properties": {}
    },
    "secrets": []
  },
  "pages": []
}
```

## 参数配置区

### 声明配置

示例：

```json
{
  "version": 1,
  "config": {
    "title": "天气插件",
    "groups": [
      {
        "id": "general",
        "title": "基础设置"
      }
    ],
    "schema": {
      "type": "object",
      "properties": {
        "enabled": {
          "type": "boolean",
          "default": true,
          "title": "启用"
        },
        "city": {
          "type": "string",
          "default": "上海",
          "title": "默认城市"
        },
        "maxEntries": {
          "type": "integer",
          "default": 10,
          "minimum": 1,
          "maximum": 100,
          "title": "最大条数"
        },
        "apiKey": {
          "type": "string",
          "secret": true,
          "title": "API Key"
        }
      }
    },
    "secrets": ["apiKey"]
  }
}
```

### 字段说明

| 字段 | 说明 |
| --- | --- |
| `type` | `string`、`number`、`integer`、`boolean` |
| `default` | 默认值 |
| `title` | 表单标签 |
| `description` | 字段说明 |
| `minimum` / `maximum` | 数字范围 |
| `enum` | 下拉选项 |
| `secret` | 密钥字段，后台只显示是否已设置 |

### 密钥规则

- `secret: true` 的字段不会回显真实值
- 普通配置保存在 `data/plugins/<pluginId>/config.json`
- 密钥保存在 `data/secrets/<pluginId>.json`
- 后台只能看到 `secretState.<key> = true/false`

### 插件读取配置

```js
const config = await ctx.pluginConfig.get("my-plugin", schema);
const apiKey = await ctx.pluginConfig.getSecret("my-plugin", "apiKey");
```

## 特殊页面

### 声明页面

```json
{
  "version": 1,
  "pages": [
    {
      "id": "memory",
      "title": "记忆库",
      "icon": "database",
      "entry": "/api/plugins/memory-manager/admin/memory",
      "theme": "shared",
      "permission": "admin"
    }
  ]
}
```

### 页面字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 页面唯一 ID |
| `title` | 是 | 下拉和导航显示名称 |
| `entry` | 是 | 页面路由 |
| `icon` | 否 | 预留图标字段 |
| `theme` | 否 | `shared` 或 `independent` |
| `permission` | 否 | 默认 `admin` |

### 路由规范

`entry` 必须使用：

```text
/api/plugins/<pluginId>/admin/<pageId>
```

插件需要在 `init(ctx)` 中注册这个路由：

```js
ctx.api.get("/api/plugins/memory-manager/admin/memory", async ({ sendHtml }) => {
  sendHtml(200, html);
});
```

## 特殊页面运行环境

特殊页面通过 sandbox iframe 加载：

```html
<iframe sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
```

页面内可使用：

```js
window.__YSBOT_ADMIN_TOKEN__
window.__YSBOT_ADMIN_THEME__
```

页面 HTML 建议引用：

```html
<link rel="stylesheet" href="/api/admin-console/design-tokens.css">
```

然后使用主题变量：

```css
body {
  background: var(--ysbot-bg);
  color: var(--ysbot-text);
  font-family: var(--ysbot-font);
}
```

## 主题变量

admin-console 提供以下设计令牌：

```text
--ysbot-bg
--ysbot-surface
--ysbot-border
--ysbot-text
--ysbot-muted
--ysbot-primary
--ysbot-danger
--ysbot-radius
--ysbot-font
```

插件页面不要硬编码颜色，应该统一使用这些变量。

## Web Components

admin-console 内部使用：

```text
ysbot-button
ysbot-badge
ysbot-modal
ysbot-toast
```

当前这些组件运行在 admin-console 自身页面内，特殊页面 iframe 不会自动继承。特殊页面暂时使用设计令牌和自包含 HTML/CSS；后续如果需要，可以再提供插件页面可用的组件包。

## 安全约定

- 管理 API 需要 Bearer 登录
- 管理服务器只允许本机访问
- 特殊页面不能暴露密钥
- 特殊页面 API 调用使用 `window.__YSBOT_ADMIN_TOKEN__`
- `admin-console.json` 不能包含密钥
- 页面 `entry` 必须使用插件自己的 `/api/plugins/<pluginId>/admin/` 前缀

## 插件生命周期

admin-console 会在以下时机重新读取 `admin-console.json`：

- 插件加载
- 插件安装
- 插件更新
- 插件重载
- 插件卸载

如果 `admin-console.json` 无效，插件仍可加载，但后台会记录错误，并且不显示配置区和特殊页面。

## 完整示例

### 目录

```text
plugins/memory-manager/
  plugin.json
  admin-console.json
  index.js
```

### plugin.json

```json
{
  "id": "memory-manager",
  "type": "capability",
  "name": "Memory Manager",
  "version": "1.0.0",
  "description": "记忆库管理插件",
  "enabled": true,
  "role": "user",
  "dependencies": []
}
```

### admin-console.json

```json
{
  "version": 1,
  "config": {
    "title": "记忆库配置",
    "schema": {
      "type": "object",
      "properties": {
        "maxEntries": {
          "type": "integer",
          "default": 100,
          "title": "最大条数"
        },
        "apiKey": {
          "type": "string",
          "secret": true,
          "title": "API Key"
        }
      }
    },
    "secrets": ["apiKey"]
  },
  "pages": [
    {
      "id": "memory",
      "title": "记忆库",
      "entry": "/api/plugins/memory-manager/admin/memory",
      "theme": "shared"
    }
  ]
}
```

### index.js

```js
export default class MemoryManagerPlugin {
  async init(ctx) {
    this.ctx = ctx;
    ctx.api.get(
      "/api/plugins/memory-manager/admin/memory",
      async ({ sendHtml }) => {
        sendHtml(
          200,
          `<!doctype html>
          <html>
            <head>
              <link rel="stylesheet" href="/api/admin-console/design-tokens.css">
            </head>
            <body>
              <h1>记忆库</h1>
              <p>特殊页面内容</p>
            </body>
          </html>`,
        );
      },
    );
  }

  async invoke(params) {
    return { ok: true, plugin: "memory-manager", params };
  }
}
```

## 开发命令

以下命令在 `ysbot-plugins` 插件工作区执行：

```powershell
node tools/ysbot.js validate memory-manager
node tools/ysbot.js test memory-manager
node tools/ysbot.js pack memory-manager
node tools/ysbot.js deploy memory-manager --mode plg
```
