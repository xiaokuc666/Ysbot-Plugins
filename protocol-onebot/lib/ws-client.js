import crypto from "node:crypto";
import { OneBotActionError } from "./errors.js";

function buildUrl(url, accessToken) {
  const parsed = new URL(url);
  if (accessToken) {
    parsed.searchParams.set("access_token", accessToken);
  }
  return parsed.toString();
}

export class OneBotWsClient {
  constructor({
    url,
    accessToken,
    requestTimeoutMs = 10000,
    heartbeatTimeoutMs = 30000,
    onEvent,
    onStatus,
    onClose,
    onError,
    WebSocketImpl = globalThis.WebSocket,
  }) {
    this.url = url;
    this.accessToken = accessToken;
    this.requestTimeoutMs = requestTimeoutMs;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.onClose = onClose;
    this.onError = onError;
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.pending = new Map();
    this.lastHeartbeatAt = Date.now();
    this.heartbeatTimer = null;
  }

  get connected() {
    return Boolean(this.socket && this.socket.readyState === 1);
  }

  connect() {
    if (this.socket) this.close();
    const socket = new this.WebSocketImpl(buildUrl(this.url, this.accessToken));
    this.socket = socket;

    socket.onopen = () => {
      this.lastHeartbeatAt = Date.now();
      this.startHeartbeat();
      this.onStatus?.({ connected: true, wsUrl: this.url });
    };
    socket.onmessage = (event) => {
      this.lastHeartbeatAt = Date.now();
      let data;
      try {
        data = JSON.parse(String(event.data));
      } catch (error) {
        this.onError?.(new OneBotActionError("ONEBOT_FAILED", "Invalid WS JSON", { wording: error.message }));
        return;
      }
      if (data?.echo && this.pending.has(data.echo)) {
        this.resolvePending(data);
        return;
      }
      this.onEvent?.(data);
    };
    socket.onerror = (event) => {
      this.onError?.(new OneBotActionError("CONNECTION_LOST", "WebSocket error", { wording: event.message }));
    };
    socket.onclose = () => {
      this.socket = null;
      this.stopHeartbeat();
      this.rejectAll(new OneBotActionError("CONNECTION_LOST", "WebSocket closed"));
      this.onStatus?.({ connected: false, wsUrl: this.url });
      this.onClose?.();
    };
  }

  startHeartbeat() {
    this.stopHeartbeat();
    if (!this.heartbeatTimeoutMs) return;
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected) return;
      if (Date.now() - this.lastHeartbeatAt > this.heartbeatTimeoutMs) {
        this.onError?.(
          new OneBotActionError("CONNECTION_LOST", "Heartbeat timeout"),
        );
        this.socket?.close();
      }
    }, Math.max(1000, Math.floor(this.heartbeatTimeoutMs / 2)));
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  resolvePending(data) {
    const { resolve, reject, timer } = this.pending.get(data.echo);
    clearTimeout(timer);
    this.pending.delete(data.echo);
    if (data.status === "ok") resolve(data);
    else reject(new OneBotActionError("ONEBOT_FAILED", data.wording || "OneBot action failed", { retcode: data.retcode, wording: data.wording, echo: data.echo }));
  }

  rejectAll(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  send(action, params = {}) {
    if (!this.connected) {
      return Promise.reject(new OneBotActionError("CONNECTION_LOST", "WebSocket not connected"));
    }
    const echo = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new OneBotActionError("REQUEST_TIMEOUT", `Action timeout: ${action}`, { echo }));
      }, this.requestTimeoutMs);
      this.pending.set(echo, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ action, params, echo }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(
          new OneBotActionError("CONNECTION_LOST", `WebSocket send failed: ${action}`, {
            wording: error.message,
          }),
        );
      }
    });
  }

  close() {
    this.stopHeartbeat();
    this.rejectAll(new OneBotActionError("CONNECTION_LOST", "WebSocket closed"));
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      try {
        this.socket.close();
      } catch {
        // Native WebSocket may throw when closing a CONNECTING socket.
      }
      this.socket = null;
    }
  }
}
