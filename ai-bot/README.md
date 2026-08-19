# AI Bot

QQ AI 聊天机器人业务插件，负责接收消息、决定是否回复、调用 llm-bridge 生成内容，再通过 action-qq 发送。

- ID: `ai-bot`
- Type: `capability`
- Role: `capability`
- Version: `0.5.2`
- 依赖: `protocol-onebot >= 1.0.0`、`action-qq >= 1.0.0`、`llm-bridge >= 0.2.0`

## 功能

- 接收 QQ 群聊/私聊事件
- 支持 @、回复、普通消息
- 每群启用/禁用
- 管理员私聊指令
- 接入 Core CuriosityBus，支持直接互动、群活跃观察、定时群探针
- 通过 memory-store 接口做记忆观察和回忆（插件未安装时自动跳过）
- 短期会话历史写入 `ctx.dataDir/history.jsonl`
- 可选接入 identity-store，注入身份上下文并记录身份交互日志
- 直接回复和好奇心回复共用统一上下文管线
- 注入东八区时间观念，支持 @ 后短期注意力窗口
- 支持执行 admin-console 配置的 LLM 工具
- 群内回复支持自动/总是/从不引用原消息和 @ 对方
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
| `curiosityEnabled` | `false` | 是否启用好奇心总线 |
| `curiosityMemoryEnabled` | `true` | 是否启用记忆联动 |
| `curiosityDirectCooldownMs` | `15000` | 直接互动冷却 |
| `curiosityGroupActiveCooldownMs` | `60000` | 群活跃冷却 |
| `curiosityPeriodicProbeEnabled` | `false` | 是否启用定时群探针 |
| `curiosityPeriodicProbeIntervalMs` | `300000` | 定时探针间隔 |
| `curiosityPeriodicProbeProbability` | `0.1` | 定时探针参与概率 |
| `curiosityRandomReplyProbability` | `0.05` | 群活跃随机回复概率 |
| `memoryRecallLimit` | `10` | 记忆召回条数上限 |
| `memoryMaxInjection` | `2000` | 记忆注入最大长度 |
| `historyMaxEntries` | `20` | 短期历史最大条数 |
| `historyMaxAgeMs` | `3600000` | 短期历史保留时间 |
| `llmTools` | `[]` | LLM 工具定义 JSON |
| `maxToolRounds` | `3` | 最大工具轮数 |
| `replyWithAt` | `true` | 群内 @ 回复是否带 @ |
| `replyWithQuote` | `true` | 群内回复是否引用原消息 |

## 好奇心总线

- `direct_interaction`：有人 @ 或回复 bot 时强制看一眼
- `group_active`：群里正在聊天时低概率观察或插话
- `periodic_probe`：定时查看已出现过的群
- `memory_update`：只更新记忆，不回复

未启用好奇心的群不会提交动机。`shouldAct=false` 的观察结果会尝试写入 `memory-store`。

## 管理员私聊指令

```text
/ai help
/ai status
/ai on <groupId>
/ai off <groupId>
/ai mode mention|all
/ai default on|off
/ai prompt <text>
/ai memory <groupId>
/ai memory clear <groupId>
/ai note <groupId> <text>
```

## 测试

```powershell
node tools/ysbot.js check ai-bot
node tools/ysbot.js test ai-bot
node tools/ysbot.js pack ai-bot
```

详细接入方式见 [docs/developer-guide.md](docs/developer-guide.md)。
