# protocol-onebot 配置说明

## 配置项

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `wsUrl` | `ws://127.0.0.1:3001` | OneBot WS 地址 |
| `httpUrl` | `http://127.0.0.1:3000` | OneBot HTTP 地址 |
| `httpBasePath` | `/` | HTTP 基础路径 |
| `autoConnect` | `false` | 启动后是否自动连接 |
| `messageFormat` | `array` | 消息格式 |
| `reconnectBaseMs` | `1000` | 重连基础间隔 |
| `reconnectMaxMs` | `30000` | 重连最大间隔 |
| `requestTimeoutMs` | `10000` | 动作请求超时 |
| `heartbeatTimeoutMs` | `30000` | 心跳超时 |
| `allowedActions` | `[]` | 允许动作，为空使用内置白名单 |
| `allowUnknownActions` | `false` | 是否允许未配置动作 |
| `accessToken` | secret | OneBot Access Token |

`accessToken` 不写入 `plugin.json`，通过 admin-console 的 secret 字段配置。
