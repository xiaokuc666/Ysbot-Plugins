# Identity Store

`identity-store` 是 ai-bot 的自我身份后置插件，负责维护身份卡、动态自我模型、交互事件日志和身份上下文检索。

- ID: `identity-store`
- Type: `capability`
- Role: `capability`
- Version: `0.1.0`
- 依赖: `@xiaokuc/ysbot >= 0.2.5`

## 功能

- 静态身份卡
- 动态 self-model
- 交互事件日志
- 身份上下文检索
- 自我反思与快照回滚
- 普通用户不可读取身份存储
- admin-console 身份管理页

## 调用

```js
await ctx.registry.invoke("identity-store", {
  action: "context",
  params: {
    groupId,
    userId,
    query: "你是谁",
    mode: "hybrid"
  },
  context: { actor, scene, traceId }
});
```

## 测试

```powershell
node tools/ysbot.js check identity-store
node tools/ysbot.js test identity-store
node tools/ysbot.js pack identity-store
```

详细接入方式见 [docs/developer-guide.md](docs/developer-guide.md)。
