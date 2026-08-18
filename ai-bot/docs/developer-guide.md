# ai-bot 开发者指南

## 概述

`ai-bot` 是 QQ AI 聊天机器人业务本体。它监听 `onebot.message` 事件，按配置决定是否回复，调用 `llm-bridge` 生成回复，再调用 `action-qq` 发送。

## 依赖链

```text
protocol-onebot -> action-qq -> ai-bot
protocol-onebot -> llm-bridge -> ai-bot
```

`ai-bot` 不直接访问 OneBot 协议，所有发送动作都通过 `action-qq`，所有生成都通过 `llm-bridge`。

## 消息事件

监听：

```text
onebot.message
```

支持：

- `group` 群聊
- `private` 私聊

## 回复策略

- `mention`：只回复包含 `at` 或 `reply` 消息段的消息
- `all`：所有允许的消息都会回复

群状态优先级：

```text
disabledGroups > enabledGroups > defaultEnabled
```

## 管理员私聊指令

只有 `adminUserIds` 中的 QQ 可以执行：

```text
/ai help
/ai status
/ai on <groupId>
/ai off <groupId>
/ai mode mention|all
/ai default on|off
/ai prompt <text>
```

指令通过 `action-qq` 私聊发送响应。

## 调用关系

生成回复：

```js
await ctx.registry.invoke("llm-bridge", {
  action: "chat",
  params: {
    messages: [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: text }
    ]
  },
  context: { actor, scene, traceId }
});
```

发送回复：

```js
await ctx.registry.invoke("action-qq", {
  action: "send_group_msg",
  params: {
    group_id,
    message: [{ type: "text", data: { text: reply } }]
  },
  context: { actor, scene, traceId }
});
```

## 权限

- 管理员指令由 `adminUserIds` 控制
- admin-console 配置页本身只允许后台管理员访问
- 普通用户不能修改 bot 配置

## 错误码与日志

`ai-bot` 使用 `ctx.logging` 注册 `ai-bot` 日志源，日志写入 `ctx.dataDir/logs/ai-bot.jsonl`，所有链路日志都带 `traceId`。
