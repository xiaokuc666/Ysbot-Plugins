# Changelog

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
