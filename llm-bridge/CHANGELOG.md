# Changelog

## 0.2.0

- 支持真正执行 `tool_calls`。
- 新增自定义工具注册：`name/plugin/action/adminOnly`。
- 支持 `executeTools: true` 和 `maxToolRounds`。
- 未注册工具、权限不足、执行失败会作为工具结果回传，不中断对话。
- 新增 `allowToolExecution` 和 `defaultMaxToolRounds` 配置。

## 0.1.0

- 首个开发版本。
- 支持用户自定义 Provider 注册表，可接入任意 OpenAI-compatible API 和 Ollama 原生 API。
- 提供 `chat` 和 `completion` 统一调用入口。
- API Key 通过 `ctx.pluginConfig` 的 `providerApiKeys` secret 统一保存。
- 支持 model、temperature、max_tokens、timeout 和 tool-call 透传。
- 日志包含 traceId，并通过 `ctx.logging` 注册插件日志源。
