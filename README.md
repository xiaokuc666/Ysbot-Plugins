# YSbot Plugins

YSbot 插件仓库。每个插件是一个独立顶层目录。

该仓库所有插件基于 admin-console 开发，均通过 `admin-console.json` 接入参数配置和特殊页面。

插件下载索引：[plugins.json](plugins.json)

## 快速开始

仓库使用纯 Node 工具，不依赖 npm 包：

```powershell
node tools/ysbot.js list
node tools/ysbot.js create capability my-plugin
node tools/ysbot.js validate
node tools/ysbot.js test
node tools/ysbot.js pack
```

第一次执行需要 Core 时会自动克隆 `xiaokuc666/Ysbot-Core` 到 `ref/`。

## 当前插件

| 插件 | 版本 | 说明 |
| --- | --- | --- |
| [admin-console](admin-console) | 1.0.1 | YSbot 插件管理后台 |
| [protocol-onebot](protocol-onebot) | 1.0.0 | 通用 OneBot v11 协议插件 |

## 目录规范

```text
Ysbot-Plugins/
  admin-console/
    plugin.json
    index.js
    lib/
    public/
    test/
    docs/
    dist/
```

以后新增插件都按这个结构放在仓库根目录：

```text
<plugin-id>/
  plugin.json
  index.js
  ...
  README.md
  docs/
  dist/
```

详细规范见 [docs/plugin-repo-convention.md](docs/plugin-repo-convention.md)。

如果插件是其它插件的前置/基础/平台插件，必须在 `docs/developer-guide.md` 中说明如何被其它插件接入和扩展。

## License

MIT
