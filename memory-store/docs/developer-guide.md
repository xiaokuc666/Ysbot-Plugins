# memory-store 开发者指南

## 概述

`memory-store` 为 ai-bot 等业务插件提供长期记忆。数据只写入插件自己的 `ctx.dataDir`，不依赖外部数据库。

## API

### observe

```js
await ctx.registry.invoke("memory-store", {
  action: "observe",
  params: { event },
  context: { actor, traceId }
});
```

从消息事件提取文本并写入一条 `fact` 记忆。

### recall

```js
await ctx.registry.invoke("memory-store", {
  action: "recall",
  params: { groupId, userId, query, limit },
  context: { actor, traceId }
});
```

返回按时间倒序的记忆列表。

### note

```js
await ctx.registry.invoke("memory-store", {
  action: "note",
  params: { groupId, userId, content, type },
  context: { actor, traceId }
});
```

`type` 可选 `note` 或 `impression`。

### list / forget / clear

- `list`：按条件筛选并分页
- `forget`：删除单条 `id`，或按 `groupId/userId` 删除
- `clear`：清空 `groupId/userId` 下所有记忆

## 权限

- `observe` / `recall` 要求 `actor.id === "ai-bot"`、`context.trusted === true`，或 `system/admin` 调用方
- `note` / `list` / `forget` / `clear` 要求管理端身份

## 记忆条目

```json
{
  "id": "mem-...",
  "ts": "2026-08-19T00:00:00.000Z",
  "groupId": "100000001",
  "userId": "200000001",
  "type": "fact",
  "content": "用户偏好文本",
  "source": "message",
  "traceId": "trace-..."
}
```

`type` 可能值：

```text
fact
note
impression
summary
```

## 日志

插件通过 `ctx.logging` 注册 `memory-store` 日志源，日志写入 `ctx.dataDir/logs/memory-store.jsonl`。
