# Changelog

## 0.5.6

- 冷群主动消息最多发一句。
- bot 发过消息后，如果群里没有人再说话，定时探针会闭嘴。
- 新增 `proactiveSilenceEnabled`，默认开启。

## 0.5.5

- @ 后注意力窗口改为滚动式：对话持续时窗口不断延长。
- 新增 `activeConversationIdleMs`，默认 120 秒无消息才掉注意力。
- 默认跟随概率提高到 0.8。

## 0.5.4

- 默认启用 `get_group_list`、`get_friend_list`、`get_login_info`、`get_group_member_info` 查询工具。
- 涉及群/好友/账号/成员等事实性问题时，系统提示要求必须调用工具，不得编造数据。

## 0.5.3

- 采用结构化回复计划：支持 LLM 返回 `{"text","at","replyTo"}`。
- 回复发送前强制去掉括号动作/神态。
- 回复只保留前 `maxReplySentences` 句。
- at 和引用优先使用结构化字段生成，不再完全依赖提示词。

## 0.5.2

- 系统提示词强制 QQ 群聊短句格式。
- 禁止回复中使用“（动作）”“（神态）”等括号描述。
- 回复保持简短，一次最多一到两句。

## 0.5.1

- 修复 @ 时看不到普通群消息上文的问题：启用群里未回复的普通消息也会写入短期历史。
- `replyWithAt` / `replyWithQuote` 改为 `auto / always / never`。
- `auto` 模式下 bot 根据回复内容判断是否带 @，根据是否明显回应某条消息判断是否引用。

## 0.5.0

- 注入东八区时间观念：当前时间、事件时间、时间差会进入 LLM 上下文。
- 会话历史带时间标签。
- 被 @ 后开启短期注意力窗口，窗口内后续消息会以更短冷却继续观察。
- 新增 `timeZone`、`directAttentionWindowMs`、`directAttentionFollowCooldownMs`、`directAttentionFollowProbability` 配置。

## 0.4.0

- 新增 `identity-store` 可选集成。
- 组装上下文时注入身份上下文，未安装 identity-store 时自动降级。
- 收到消息时写入身份交互日志，用于后续自我反思。

## 0.3.1

- 修复 LLM 回复内容前出现“烟散：”“Bot：”等说话人前缀的问题。
- 系统提示词明确要求直接输出回复内容。
- bot 自己的会话历史不再以 `Bot:` 前缀注入，避免模型模仿。

## 0.3.0

- 直接回复和好奇心回复统一为同一套上下文组装管线。
- 回复前注入近期记忆、短期会话历史、当前事件上下文。
- 新增 `history.jsonl` 短期会话历史，按群/私聊隔离并自动清理。
- 支持把 admin-console 配置的 `llmTools` 传给 llm-bridge 并执行。
- 群内回复支持带 `reply` 引用和 `at` 消息段。
- 日志记录记忆条数、历史条数、工具调用轮数和 traceId。

## 0.2.2

- 修复 memory-store recall 返回数组时误取 `Array.prototype.entries` 导致回复链路崩溃的问题。
- 修复无消息事件的 curiosity 动机写记忆时传入 `null` 导致 observe 失败的问题。
- 兼容 memory-store 的数组返回结构和 `{ entries: [] }` 返回结构。

## 0.2.1

- 新增管理员记忆指令：`/ai memory`、`/ai note`、`/ai memory clear`。
- memory-store 未安装时给出友好提示。
- 支持记忆召回数量上限配置。

## 0.2.0

- 接入 Core CuriosityBus。
- 支持直接互动、群活跃观察和定时群探针。
- 支持 memory-store 观察/回忆联动，插件未安装时自动跳过。
- 后台可配置所有好奇心参数。

## 0.1.0

- 首个开发版本。
- 接收 QQ 群聊和私聊事件。
- 支持 @、回复和普通消息回复策略。
- 支持每群启用/禁用。
- 支持管理员私聊指令。
- 接入 Core CuriosityBus，支持直接互动、群活跃观察和定时群探针。
- 支持 memory-store 观察/回忆联动，插件未安装时自动跳过。
- 日志 traceId 贯穿 llm-bridge 和 action-qq。
