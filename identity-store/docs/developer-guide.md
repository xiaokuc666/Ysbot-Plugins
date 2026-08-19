# identity-store 开发者指南

## 概述

`identity-store` 为 ai-bot 提供稳定的自我身份和动态自我认知。

## 数据文件

```text
ctx.dataDir/
  identity-card.json
  self-model.json
  journal.jsonl
  snapshot.json
  snapshots/
```

## Actions

```text
context
journal
get_card
get_self
update_card
reflect
reset
rollback
stats
```

`context` / `journal` 只允许 ai-bot 或受信任调用方；其余动作默认仅管理端。

## ai-bot 集成

ai-bot 在组装上下文时调用 `identity-store.context`，并把返回的 `<identity_context>` 注入 system prompt 之后。

ai-bot 在收到消息时调用 `identity-store.journal` 写入精炼事件，不保存完整聊天原文。
