# action-qq 配置说明

配置通过 admin-console 保存，普通值写入插件 `ctx.dataDir/config.json`。

## 配置项

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `enabledActions` | `[]` | 启用动作；为空时使用 v1.0.0 内置白名单 |
| `allowUnknownActions` | `false` | 是否允许未列入白名单的动作 |
| `managementOnlyActions` | 全部管理动作 | 管理动作，要求 `admin` 或显式 `approved` |
| `requireApprovalActions` | 全部管理动作 | 需审批动作，要求 `admin` 或显式 `approved` |
| `maxMessageLength` | `5000` | 文本消息最大字符数 |

## 示例

```json
{
  "enabledActions": [],
  "allowUnknownActions": false,
  "managementOnlyActions": [
    "delete_msg",
    "set_group_card",
    "set_group_name",
    "set_group_ban",
    "set_group_whole_ban",
    "set_group_kick",
    "set_group_admin",
    "set_group_special_title",
    "set_friend_add_request",
    "set_group_add_request"
  ],
  "requireApprovalActions": [
    "delete_msg",
    "set_group_card",
    "set_group_name",
    "set_group_ban",
    "set_group_whole_ban",
    "set_group_kick",
    "set_group_admin",
    "set_group_special_title",
    "set_friend_add_request",
    "set_group_add_request"
  ],
  "maxMessageLength": 5000
}
```

## 读取

插件通过 `ctx.pluginConfig.get("action-qq", schema)` 读取配置。
