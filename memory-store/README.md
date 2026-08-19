# Memory Store

QQ AI bot 的长期记忆系统，为 ai-bot 提供群内事实、用户偏好、管理员笔记和会话摘要。

- ID: `memory-store`
- Type: `capability`
- Role: `capability`
- Version: `1.0.0`
- 依赖: `@xiaokuc/ysbot >= 0.2.5`

## 功能

- 每个群独立记忆
- 每个用户独立记忆
- 记录客观事实
- 支持管理员笔记
- 生成会话摘要
- 管理员后台查看、筛选、删除、清空
- 普通成员不可查看记忆内容

## 调用

```js
await ctx.registry.invoke("memory-store", {
  action: "observe",
  params: { event, traceId }
});

await ctx.registry.invoke("memory-store", {
  action: "recall",
  params: { groupId, userId, query, limit }
});
```

支持动作：

```text
observe
recall
note
list
forget
clear
summarize
stats
```

## 权限

- `observe` / `recall`：只允许 `ai-bot` 或受信任调用方
- `note` / `list` / `forget` / `clear`：仅管理端身份

## 后台页面

admin-console 特殊页面 `记忆管理`：

- 按群、按用户、按关键词筛选
- 显示记忆来源、时间、类型
- 写管理员笔记
- 删除单条记忆
- 清空指定群记忆

## 测试

```powershell
node tools/ysbot.js check memory-store
node tools/ysbot.js test memory-store
node tools/ysbot.js pack memory-store
```

详细接入方式见 [docs/developer-guide.md](docs/developer-guide.md)。
