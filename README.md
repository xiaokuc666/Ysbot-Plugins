# YSbot Plugins

YSbot 插件仓库。每个插件是一个独立顶层目录。
该仓库所有插件基于 `admin-console` 开发，均通过 `admin-console.json` 接入参数配置和特殊页面。
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
| [admin-console](admin-console) | 1.0.3 | YSbot 插件管理后台 |
| [protocol-onebot](protocol-onebot) | 1.0.1 | 通用 OneBot v11 协议插件 |
| [action-qq](action-qq) | 1.0.0 | 通用 QQ 动作插件 |
| [llm-bridge](llm-bridge) | 0.1.0 | 统一大模型接入层 |
| [ai-bot](ai-bot) | 0.1.0 | QQ AI 聊天机器人业务插件 |

## 当前能力

### llm-bridge 0.1.0

- 通过用户自定义 Provider 注册表接入任意 OpenAI-compatible API。
- 支持 Ollama 原生 `/api/chat` 和 `/api/generate`。
- 提供 `chat` 和 `completion` 统一调用入口。
- API Key 统一保存到 `providerApiKeys` secret，支持 JSON 对象或直接填默认 Provider 的明文 Key。
- 支持 model、temperature、max_tokens、timeout 和 tool-call 透传。
- 后台配置页提供 `测试当前 Provider` 按钮。
- 配置修改后立即生效，日志带 traceId。

### ai-bot 0.1.0

- 监听 QQ 群聊和私聊事件。
- 支持 @、回复和普通消息回复策略。
- 支持每群启用/禁用。
- 通过 `llm-bridge` 生成回复，通过 `action-qq` 发送回复。
- 支持管理员私聊指令。
- 非管理员不能修改 bot 配置。
- 日志 traceId 贯穿 llm-bridge 和 action-qq。

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
