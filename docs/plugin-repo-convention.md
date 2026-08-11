# YSbot Plugins 仓库规范

## 插件目录

每个插件在仓库根目录使用独立目录：

```text
<plugin-id>/
  plugin.json
  index.js
  lib/
  public/
  test/
  README.md
  docs/
  dist/
```

## 必含内容

- `plugin.json`：插件清单
- `index.js`：插件入口
- `README.md`：插件说明
- `docs/`：插件接入文档和特殊说明
- `dist/`：发布用的 `.plg` 文件

## 开发规范

- 插件 ID 使用小写 kebab-case。
- 插件数据只写自己的 `ctx.dataDir`。
- 密钥通过 `ctx.pluginConfig` 或 `ctx.secrets` 读写，不写入 `plugin.json`。
- 需要接入 admin-console 时提供 `admin-console.json` 和特殊页面路由。

## 文档要求

每个插件 README 至少包含：

- 插件功能说明
- 插件 ID、类型、版本
- 配置说明
- 特殊页面说明
- 发布产物位置

如果插件是“前置插件 / 基础插件 / 平台插件”，即其它插件会依赖它、扩展它或调用它提供的能力，则必须额外附一份开发者指南：

```text
<plugin-id>/docs/developer-guide.md
```

开发者指南至少包含：

- 其它插件如何接入该插件
- 该插件对外提供的 API / 上下文 / 事件 / 任务类型
- 配置项和密钥规范
- 如果提供后台页面：页面入口、页面标准、主题变量、权限要求
- 完整示例

普通独立插件只需 `README.md`；只有会被其它插件依赖或扩展的插件才必须提供开发者指南。
