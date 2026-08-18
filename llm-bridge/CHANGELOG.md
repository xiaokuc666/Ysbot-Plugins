# Changelog

## 0.1.0

- 首个开发版本。
- 支持用户自定义 Provider 注册表，可接入任意 OpenAI-compatible API 和 Ollama 原生 API。
- 提供 `chat` 和 `completion` 统一调用入口。
- API Key 通过 `ctx.pluginConfig` 的 `providerApiKeys` secret 统一保存，支持 JSON 或明文。
- 支持 model、temperature、max_tokens、timeout 和 tool-call 透传。
- 后台配置页提供 Provider 测试按钮，并展示详细错误。
- 配置修改后立即生效。
- 日志包含 traceId，并通过 `ctx.logging` 注册插件日志源。
