# QQ Action

通用 QQ 动作插件，基于 OneBot v11 和 `protocol-onebot`，为业务插件提供稳定、可鉴权的 QQ 动作入口。

- ID: `action-qq`
- Type: `action`
- Role: `action`
- Version: `1.0.1`
- 依赖: `protocol-onebot >= 1.2.0`

## 功能

- 标准 OneBot v11 动作白名单
- owner/admin/member 三级权限控制
- 标准 OneBot 消息段校验和透传
- `traceId` 透传和插件日志
- admin-console 配置区和状态页
- admin-console QQ 聊天页：自动拉取群/好友列表，按身份分类，发送标准消息段，按权限撤回消息

## 调用

```js
await ctx.registry.invoke("action-qq", {
  action: "send_group_msg",
  params: {
    group_id: "100000001",
    message: [
      { type: "text", data: { text: "晚上好" } },
      { type: "at", data: { qq: "200000001" } }
    ]
  },
  context: {
    actor: {
      id: "200000001",
      role: "member"
    },
    scene: {
      type: "group",
      id: "100000001"
    }
  }
});
```

成功返回：

```json
{
  "ok": true,
  "action": "send_group_msg",
  "data": {
    "message_id": 42
  }
}
```

## 动作

v1.0.0 支持标准 OneBot v11：

```text
send_msg
send_group_msg
send_private_msg
delete_msg
get_msg
get_forward_msg
send_like
set_group_kick
set_group_ban
set_group_whole_ban
set_group_admin
set_group_card
set_group_name
set_group_leave
set_group_special_title
set_friend_add_request
set_group_add_request
get_login_info
get_stranger_info
get_friend_list
get_group_info
get_group_list
get_group_member_info
get_group_member_list
get_group_honor_info
get_image
get_record
can_send_image
can_send_record
get_status
get_version_info
get_cookies
get_csrf_token
get_credentials
set_restart
clean_cache
```

另外支持 `send_group_forward_msg` 合并转发。

## 权限模型

```text
群主
  管理员全部能力
  撤回管理员消息
  禁言管理员
  设置管理员
  设置群专属头衔

管理员
  撤回普通成员消息
  踢人/禁言普通成员
  全员禁言
  设置群名片/群名
  处理加群请求

普通成员
  撤回自己发送的消息
```

`get_cookies`、`get_csrf_token`、`get_credentials`、`set_restart`、`clean_cache` 需要管理员/群主身份。

## 后台聊天页

- 自动拉取群列表和好友列表
- 按机器人身份归类：群主 / 管理 / 成员 / 私聊
- 群主和管理员群可撤回消息
- 成员群和私聊仅可撤回机器人自己发送的消息
- 撤回后查询确认，确认成功才标记已撤回
- 消息详情手动展开/关闭，不会因刷新自动关闭

## 配置

通过 admin-console 配置区修改：

- `enabledActions`
- `allowUnknownActions`
- `managementOnlyActions`
- `requireApprovalActions`
- `maxMessageLength`

详细说明见 [docs/config.md](docs/config.md)。

## 开发者指南

业务插件接入方式见 [docs/developer-guide.md](docs/developer-guide.md)。

## 后台页面

- `QQ 聊天`：`/api/plugins/action-qq/admin/chat`
- `QQ 动作状态`：`/api/plugins/action-qq/admin/status`

## 测试

```powershell
node tools/ysbot.js check action-qq
node tools/ysbot.js test action-qq
node tools/ysbot.js pack action-qq
```
