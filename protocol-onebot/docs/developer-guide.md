# protocol-onebot 开发者指南

## 概述

`protocol-onebot` 是 YSbot Core 的前置协议插件，负责把 OneBot v11 的 WS/HTTP 能力接入 Core。

其它插件可以通过统一入口调用 OneBot 动作，并消费标准化后的 QQ 事件。

## 调用入口

v1.0.0 使用：

```js
await ctx.registry.invoke("protocol-onebot", {
  action: "send_group_msg",
  params: {
    group_id: "100000001",
    message: [
      {
        type: "text",
        data: { text: "hello" }
      }
    ]
  },
  context: {
    actor,
    scene
  }
});
```

## 消息段

`message` 使用 OneBot v11 消息段数组。

文本：

```json
{
  "type": "text",
  "data": { "text": "hello" }
}
```

图片：

```json
{
  "type": "image",
  "data": { "file": "https://example.com/a.png" }
}
```

`protocol-onebot` 不做图片上传，只透传消息段。

## actor/scene

发送动作时必须提供 `context.actor` 和 `context.scene`。

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
  }
}
```

## 事件输出

消息事件通过 `ctx.protocol.emit()` 输出主链路，同时提供 `onebot.message` 辅助事件。

标准化群消息：

```js
{
  id: "100",
  message_type: "group",
  group_id: "100000001",
  user_id: "200000001",
  sender: {
    id: "200000001",
    nickname: "cola",
    card: "",
    role: "member"
  },
  message: [],
  raw_message: "...",
  raw: {},
  timestamp: 1700000000,
  actor: {
    id: "200000001",
    origin: "qq",
    admin: false,
    roles: ["member"]
  },
  scene: {
    type: "group",
    id: "100000001"
  }
}
```

辅助事件：

```text
onebot.message
onebot.notice
onebot.request
onebot.meta
onebot.status
```

## 动作白名单

内置动作：

```text
send_group_msg
send_private_msg
delete_msg
send_group_forward_msg
set_group_card
set_group_name
set_group_ban
set_group_whole_ban
set_group_kick
set_group_admin
set_group_special_title
set_friend_add_request
set_group_add_request
get_login_info
get_group_list
get_friend_list
get_group_member_info
get_group_member_list
```

未配置动作默认拒绝。

## 权限

发送动作要求 `actor/scene`。

`delete_msg` 和群管理动作要求：

- `context.actor.admin === true`
- 或 `context.approved === true`

业务层“谁能发消息”由上层插件负责，`protocol-onebot` 不代替业务层判断。

## 错误

```js
class OneBotActionError extends Error {
  code;
  retcode;
  wording;
  echo;
}
```

错误码：

```text
UNSUPPORTED_ACTION
REQUEST_TIMEOUT
CONNECTION_LOST
ONEBOT_FAILED
PERMISSION_DENIED
INVALID_CONTEXT
```

## 状态页

状态页由 admin-console 提供入口：

```text
GET /api/plugins/protocol-onebot/admin/status
GET /api/plugins/protocol-onebot/admin/status.json
POST /api/plugins/protocol-onebot/admin/reconnect
```

页面使用 `window.__YSBOT_ADMIN_TOKEN__` 和 `window.__YSBOT_ADMIN_THEME__`。
