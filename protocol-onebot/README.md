# OneBot Protocol

通用 OneBot v11 协议插件，用于连接 SL、NapCat、Lagrange 等 OneBot 兼容框架。

## 功能

- OneBot WS 事件接收
- OneBot WS / HTTP 动作发送
- WS 失败自动回退 HTTP
- 断线重连
- 心跳超时检测
- 消息事件标准化
- `actor/scene` 输出
- 动作白名单和敏感动作保护
- admin-console 配置区和状态页

## 状态

v1.0.0

## 配置

通过 admin-console 配置区修改。

详细配置见 `docs/config.md`。

## 开发者指南

见 `docs/developer-guide.md`。

## 测试

```powershell
npm run check
npm test
```
