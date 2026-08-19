# Changelog

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
