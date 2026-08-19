# LLM Bridge

统一大模型接入层，通过用户自定义的 Provider 注册表接入任意 OpenAI-compatible API 或 Ollama 原生 API。

- ID: `llm-bridge`
- Type: `capability`
- Role: `capability`
- Version: `0.2.0`
- 依赖: `@xiaokuc/ysbot >= 0.2.5`

## 功能

- 支持任意 OpenAI-compatible API
- 支持 Ollama 原生 `/api/chat` 和 `/api/generate`
- 每个 Provider 可独立配置 `baseUrl`、`model`、`headers`、是否需要 API Key
- 通过 `ctx.registry.invoke` 调用
- 支持 `chat` 和 `completion`
- API Key 统一保存在 `providerApiKeys` secret
- 支持 `model`、`temperature`、`max_tokens`、`timeout`
- 支持 tool-call 请求透传，也支持 `executeTools: true` 真正执行工具
- 支持自定义工具注册：`name/plugin/action/adminOnly`
- 参数配置页提供“测试当前 Provider”按钮，可验证 API 是否可用
- 日志带 `traceId`

## 配置

通过 admin-console 的 `LLM Bridge 配置` 修改，或直接写入插件 `config.json` 和 secret。

普通配置：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `defaultProvider` | `deepseek` | 默认 Provider ID |
| `defaultModel` | 空 | 全局默认模型 |
| `timeoutMs` | `30000` | 请求超时 |
| `allowTools` | `true` | 是否允许 tool-call 透传 |
| `allowToolExecution` | `true` | 是否允许执行 tool_calls |
| `defaultMaxToolRounds` | `3` | 默认最大工具轮数 |
| `providers` | 内置三个示例 | Provider 注册表 |

Provider 示例：

```json
{
  "id": "my-openai",
  "name": "My OpenAI Compatible",
  "type": "openai",
  "baseUrl": "https://example.com/v1",
  "model": "my-model",
  "enabled": true,
  "apiKeyRequired": true,
  "headers": {
    "X-Custom": "value"
  }
}
```

`type` 可选：

- `openai`：OpenAI-compatible `/v1/chat/completions` 和 `/v1/completions`
- `ollama`：Ollama 原生 `/api/chat` 和 `/api/generate`

API Key 以 JSON 对象写入 secret `providerApiKeys`：

```json
{
  "my-openai": "sk-xxx",
  "deepseek": "sk-xxx"
}
```

也可以直接填一个明文 Key，插件会把它当作当前 `defaultProvider` 的 Key：

```text
sk-xxx
```

## 调用

```js
const result = await ctx.registry.invoke("llm-bridge", {
  action: "chat",
  params: {
    provider: "my-openai",
    model: "my-model",
    messages: [
      { role: "user", content: "你好" }
    ],
    temperature: 0.7,
    max_tokens: 1024
  },
  context: {
    actor,
    scene,
    traceId
  }
});
```

## 工具执行

调用方传入自定义工具定义并开启 `executeTools`：

```js
const result = await ctx.registry.invoke("llm-bridge", {
  action: "chat",
  params: {
    messages,
    tools: [
      {
        name: "recall_memory",
        description: "召回 bot 对群或用户的记忆",
        plugin: "memory-store",
        action: "recall",
        adminOnly: false
      }
    ],
    executeTools: true,
    maxToolRounds: 3
  },
  context: { actor, scene, traceId }
});
```

最终返回会包含 `data.toolTrace`，工具执行失败会作为 tool 结果回传，不中断对话。

## 后台测试

在 admin-console 的 `LLM Bridge 配置` 页底部有 `测试当前 Provider` 按钮。点击后会保存当前表单并发送一条最小 chat 请求，返回耗时和模型回复摘要。不会在后台显示 API Key。

## 测试

```powershell
node tools/ysbot.js check llm-bridge
node tools/ysbot.js test llm-bridge
node tools/ysbot.js pack llm-bridge
```

详细接入方式见 [docs/developer-guide.md](docs/developer-guide.md)。
