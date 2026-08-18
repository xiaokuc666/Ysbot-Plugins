# AI Bot

QQ AI 聊天机器人业务插件，负责接收消息、决定是否回复、调用 llm-bridge 生成内容，再通过 action-qq 发送。

- ID: `ai-bot`
- Type: `capability`
- Role: `capability`
- Version: `0.1.0`
- 依赖: `protocol-onebot >= 1.0.0`、`action-qq >= 1.0.0`、`llm-bridge >= 0.1.0`

## 功能

- 接收 QQ 群聊/私聊事件
- 支持 @、回复、普通消息
- 每群启用/禁用
- 管理员私聊指令
- 日志 traceId 贯穿全链路

## 配置

通过 admin-console 的 `AI Bot 配置` 修改。

常用配置：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `defaultEnabled` | `false` | 群默认是否回复 |
| `privateEnabled` | `false` | 私聊是否回复 |
| `defaultReplyMode` | `mention` | `mention` 只回 @/回复，`all` 回普通消息 |
| `enabledGroups` | `[]` | 明确启用的群 |
| `disabledGroups` | `[]` | 明确禁用的群 |
| `adminUserIds` | `[]` | 管理员 QQ |
| `systemPrompt` | 默认提示词 | LLM 系统提示词 |
| `llmProvider` | 空 | 可覆盖 llm-bridge Provider |
| `llmModel` | 空 | 可覆盖模型 |

## 管理员私聊指令

```text
/ai help
/ai status
/ai on <groupId>
/ai off <groupId>
/ai mode mention|all
/ai default on|off
/ai prompt <text>
```

## 测试

```powershell
node tools/ysbot.js check ai-bot
node tools/ysbot.js test ai-bot
node tools/ysbot.js pack ai-bot
```

详细接入方式见 [docs/developer-guide.md](docs/developer-guide.md)。
