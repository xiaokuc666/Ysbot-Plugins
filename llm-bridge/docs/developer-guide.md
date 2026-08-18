# llm-bridge 开发者指南

## 概述

`llm-bridge` 是 YSbot 的统一大模型接入层。业务插件通过 `ctx.registry.invoke("llm-bridge", ...)` 调用，不直接依赖具体 LLM SDK。

## Provider 注册表

所有 Provider 都定义在 `providers` 数组中。每个条目至少包含：

```json
{
  "id": "my-openai",
  "name": "My OpenAI Compatible",
  "type": "openai",
  "baseUrl": "https://example.com/v1",
  "model": "my-model",
  "enabled": true,
  "apiKeyRequired": true,
  "headers": {}
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | Provider 唯一 ID，调用时使用 |
| `name` | 否 | 展示名称 |
| `type` | 否 | `openai` 或 `ollama`，默认 `openai` |
| `baseUrl` | 是 | API 基础地址 |
| `model` | 否 | 该 Provider 默认模型 |
| `enabled` | 否 | 是否启用，默认 `true` |
| `apiKeyRequired` | 否 | 是否强制要求 API Key |
| `headers` | 否 | 额外请求头 |

## API Key

所有 Provider 的 Key 统一写入 secret `providerApiKeys`，格式是 JSON 对象：

```json
{
  "my-openai": "sk-xxx",
  "deepseek": "sk-xxx"
}
```

如果只配置一个默认 Provider，也可以直接填明文 Key，插件会把它当作 `defaultProvider` 的 Key。

也兼容旧式单 Key secret：

```text
deepseekApiKey
openaiApiKey
localApiKey
```

## 调用入口

```js
await ctx.registry.invoke("llm-bridge", {
  action: "chat",
  params: {
    provider: "my-openai",
    model: "my-model",
    messages: [
      { role: "user", content: "hello" }
    ]
  },
  context: {
    actor,
    scene,
    traceId: "trace-xxx"
  }
});
```

支持动作：

- `chat`
- `completion`
- `providers`

## 参数

`chat`：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `provider` | 否 | Provider ID；默认用 `defaultProvider` |
| `model` | 否 | 覆盖 Provider 默认模型 |
| `messages` | 是 | OpenAI messages 数组 |
| `temperature` | 否 | 采样温度 |
| `max_tokens` | 否 | 最大 token 数 |
| `timeoutMs` | 否 | 单次请求超时 |
| `tools` | 否 | tool-call 定义，v0.1 只透传不执行 |
| `tool_choice` | 否 | tool-call 选择策略 |

`completion`：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `provider` | 否 | Provider ID |
| `model` | 否 | 模型 |
| `prompt` | 是 | 文本 prompt |
| `temperature` | 否 | 采样温度 |
| `max_tokens` | 否 | 最大 token 数 |
| `timeoutMs` | 否 | 单次请求超时 |

## 返回

成功返回：

```json
{
  "ok": true,
  "action": "chat",
  "provider": "my-openai",
  "model": "my-model",
  "data": {
    "choices": [],
    "toolCalls": null,
    "executedTools": false
  },
  "traceId": "trace-xxx"
}
```

失败抛出 `LLMBridgeError`。

## Tool Call

v0.1 支持把 `tools` / `tool_choice` 透传给 Provider，并把返回的 `message.tool_calls` 放到 `data.toolCalls`。当前不会执行工具，`data.executedTools` 固定为 `false`。

## 后台测试

admin-console 的 `LLM Bridge 配置` 页会显示 `测试当前 Provider` 动作按钮。点击后会先保存当前表单，再向 `/api/plugins/llm-bridge/admin/providers/test` 发送测试请求。测试请求只发送最小内容，不会把 API Key 返回给前端。

## 错误码

```text
INVALID_CONTEXT
INVALID_PARAMS
UNSUPPORTED_ACTION
PROVIDER_NOT_CONFIGURED
NO_API_KEY
REQUEST_TIMEOUT
CONNECTION_LOST
PROVIDER_ERROR
INVALID_RESPONSE
DISPOSED
INTERNAL
```
