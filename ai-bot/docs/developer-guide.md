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

## CuriosityBus 接入

ai-bot 使用 Core 注入的 `ctx.curiosity`：

```js
await ctx.curiosity.submit({
  type: "direct_interaction",
  groupId: "100000001",
  cooldownMs: 15000,
  shouldAct: true,
  payload: { event, traceId }
});
```

监听事件：

```text
curiosity.motivation
curiosity.decision
```

动机类型：

```text
direct_interaction
group_active
periodic_probe
memory_update
```

决策处理：

- `shouldAct=true`：走统一上下文管线，调用 llm-bridge 生成回复，再通过 action-qq 发送
- `shouldAct=false`：如果安装了 memory-store，调用 `observe` 写入观察结果
- 回复前如果安装了 memory-store，会调用 `recall` 获取近期记忆并注入 prompt

memory-store 未安装时不会报错，会跳过记忆相关调用。

## 统一上下文

直接回复和好奇心回复共用同一套 `buildReplyContext -> llm-bridge -> action-qq` 管线。

每次生成回复前会组装：

- 系统提示词
- 近期记忆
- 当前事件上下文
- 短期会话历史
- 当前用户消息

短期历史保存在 `ctx.dataDir/history.jsonl`，按 `group:<id>` 和 `private:<id>` 隔离，受 `historyMaxEntries` / `historyMaxAgeMs` 控制。

## 工具调用

`llmTools` 由 admin-console 配置，ai-bot 会把工具定义传给 llm-bridge 并开启 `executeTools: true`：

```js
{
  name: "recall_memory",
  description: "召回 bot 对群或用户的记忆",
  plugin: "memory-store",
  action: "recall",
  adminOnly: false
}
```

工具执行失败不会中断回复，工具调用链会记录在日志中。

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
/ai memory <groupId>
/ai memory clear <groupId>
/ai note <groupId> <text>
```

指令通过 `action-qq` 私聊发送响应。

### 记忆指令

- `/ai memory <groupId>`：查看指定群记忆
- `/ai memory clear <groupId>`：清空指定群记忆
- `/ai note <groupId> <text>`：向指定群写入管理员笔记

memory-store 未安装时，这些指令会返回友好提示，不会报错。

## 调用关系

生成回复：

```js
await ctx.registry.invoke("llm-bridge", {
  action: "chat",
  params: {
    messages,
    tools: config.llmTools || [],
    executeTools: true,
    maxToolRounds: config.maxToolRounds || 3
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
    message: [
      { type: "reply", data: { id: replyTo } },
      { type: "at", data: { qq: user_id } },
      { type: "text", data: { text: reply } }
    ]
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
