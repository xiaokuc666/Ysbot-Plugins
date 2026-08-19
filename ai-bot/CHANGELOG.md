# Changelog

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
