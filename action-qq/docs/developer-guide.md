# action-qq 开发者指南

## 概述

`action-qq` 是 YSbot 的通用 QQ 动作层。业务插件不直接调用 `protocol-onebot`，而是统一调用 `action-qq`。

## 调用入口

```js
await ctx.registry.invoke("action-qq", {
  action: "send_group_msg",
  params: {
    group_id: "100000001",
    message: [
      { type: "text", data: { text: "hello" } }
    ]
  },
  context: {
    actor,
    scene,
    traceId
  }
});
```

## context

写操作必须提供 `actor` 和 `scene`：

```js
{
  actor: {
    id: "200000001",
    origin: "qq",
    admin: false,
    roles: ["member"]
  },
  scene: {
    type: "group",
    id: "100000001"
  },
  traceId: "trace-xxx"
}
```

`traceId` 可选；未提供时由 `action-qq` 生成，并透传给 `protocol-onebot`。

## 消息段

`message` 使用 OneBot v11 消息段数组，也允许直接传字符串。

```js
[
  { type: "text", data: { text: "晚上好" } },
  { type: "at", data: { qq: "200000001" } },
  { type: "reply", data: { id: "123" } },
  { type: "image", data: { file: "https://example.com/a.png" } }
]
```

`action-qq` 只校验和透传，不处理图片上传、文件转换。

## 权限

- 写操作必须有 `actor/scene`
- `send_group_msg` 必须是群场景，且 `group_id` 与 `scene.id` 一致
- `send_private_msg` 必须是私聊场景，且 `user_id` 与 `scene.id` 一致
- `send_group_forward_msg` 必须是群场景，且 `group_id` 与 `scene.id` 一致
- 群管理动作按 `owner > admin > member` 层级校验
- 管理员只能管理普通成员，群主可以管理管理员和普通成员
- `set_group_admin`、`set_group_special_title` 仅群主可用
- `delete_msg` 只允许撤回自己的消息，或按群主/管理员权限撤回对应成员消息
- 查询动作不要求 `actor/scene`

## 群管理动作

```text
set_group_card
set_group_name
set_group_ban
set_group_whole_ban
set_group_kick
set_group_admin
set_group_special_title
set_friend_add_request
set_group_add_request
```

示例：

```js
await ctx.registry.invoke("action-qq", {
  action: "set_group_ban",
  params: {
    group_id: "100000001",
    user_id: "200000001",
    duration: 600
  },
  context: {
    actor: {
      id: "management",
      admin: true
    },
    scene: {
      type: "group",
      id: "100000001"
    }
  }
});
```

## 返回值

成功：

```json
{
  "ok": true,
  "action": "send_group_msg",
  "data": {
    "message_id": 42
  }
}
```

失败抛出 `QqActionError`：

```js
{
  name: "QqActionError",
  code: "PERMISSION_DENIED",
  action: "delete_msg",
  retcode: null,
  wording: null,
  message: "delete_msg requires admin or explicit approval"
}
```

常见错误码：

```text
INVALID_CONTEXT
INVALID_MESSAGE
MESSAGE_TOO_LONG
UNSUPPORTED_ACTION
PERMISSION_DENIED
ONEBOT_FAILED
CONNECTION_LOST
REQUEST_TIMEOUT
DISPOSED
INTERNAL
```

## 后台页面

`action-qq` 提供状态页：

```text
GET /api/plugins/action-qq/admin/status
GET /api/plugins/action-qq/admin/status.json
```

特殊页面由 admin-console 通过 `admin-console.json` 暴露，页面使用 `window.__YSBOT_ADMIN_TOKEN__` 调用状态接口。

还提供 QQ 聊天页：

```text
GET  /api/plugins/action-qq/admin/chat
GET  /api/plugins/action-qq/admin/chat/scenes
GET  /api/plugins/action-qq/admin/chat/contacts
GET  /api/plugins/action-qq/admin/chat/messages
POST /api/plugins/action-qq/admin/chat/send
POST /api/plugins/action-qq/admin/chat/delete
POST /api/plugins/action-qq/admin/chat/clear
```

聊天页使用插件自己的 `ctx.dataDir/chat.jsonl` 保存最近会话记录，仅记录文本展示所需信息。

`POST /api/plugins/action-qq/admin/chat/send` 接受标准 OneBot 消息段：

```json
{
  "sceneType": "group",
  "sceneId": "100000001",
  "message": [
    { "type": "text", "data": { "text": "hello" } },
    { "type": "at", "data": { "qq": "200000001" } }
  ]
}
```

也兼容直接传字符串 `text`。消息列表会返回 `segments`、`sender`、`raw`、`messageId` 等完整展示信息。
