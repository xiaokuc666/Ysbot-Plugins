import { OneBotActionError } from "./errors.js";

function joinUrl(baseUrl, basePath, action) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  const prefix = String(basePath || "/").replace(/\/+$/, "");
  return `${root}${prefix}/${action}`;
}

export class OneBotHttpClient {
  constructor({ url, basePath = "/", accessToken, requestTimeoutMs = 10000 }) {
    this.url = url;
    this.basePath = basePath;
    this.accessToken = accessToken;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async send(action, params = {}) {
    if (!this.url) {
      throw new OneBotActionError("CONNECTION_LOST", "HTTP URL is not configured");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(joinUrl(this.url, this.basePath, action), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.accessToken
            ? { Authorization: `Bearer ${this.accessToken}` }
            : {}),
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new OneBotActionError(
          "ONEBOT_FAILED",
          `HTTP ${response.status} from OneBot`,
          { wording: response.statusText },
        );
      }
      const data = await response.json();
      if (data.status === "failed") {
        throw new OneBotActionError("ONEBOT_FAILED", data.wording || "OneBot action failed", {
          retcode: data.retcode,
          wording: data.wording,
        });
      }
      return data;
    } catch (error) {
      if (error instanceof OneBotActionError) throw error;
      if (error.name === "AbortError") {
        throw new OneBotActionError("REQUEST_TIMEOUT", `Action timeout: ${action}`);
      }
      throw new OneBotActionError("CONNECTION_LOST", `HTTP request failed: ${action}`, {
        wording: error.message,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
