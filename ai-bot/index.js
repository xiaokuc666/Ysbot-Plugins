import {
  groupEnabled,
  loadPluginConfig,
  savePluginConfig,
} from "./lib/config.js";
import { createPluginLogger } from "./lib/logger.js";

function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default class AiBotPlugin {
  async init(ctx) {
    this.ctx = ctx;
    this.disposed = false;
    this.config = await loadPluginConfig(ctx);
    this.log = await createPluginLogger(ctx);
    this.cooldowns = new Map();
    this.unsubscribe = ctx.eventBus.on("onebot.message", (event) => {
      this.handleMessage(event).catch((error) => {
        this.log.warn("ai", `event handling failed: ${error.message}`, {
          traceId: event?.traceId || null,
        });
      });
    });
  }

  async handleMessage(event) {
    if (this.disposed || !event) return;
    if (event.message_type !== "group" && event.message_type !== "private") {
      return;
    }
    const traceId = event.traceId || generateTraceId();
    const config = await loadPluginConfig(this.ctx);

    if (event.message_type === "private") {
      const handled = await this.tryHandlePrivateCommand(
        event,
        config,
        traceId,
      );
      if (handled) return;
      if (!config.privateEnabled) return;
      await this.replyToMessage(event, config, traceId);
      return;
    }

    const groupId = String(event.group_id || "");
    if (!groupId) return;
    if (!groupEnabled(config, groupId)) {
      this.log.debug("ai", "group disabled", { traceId, groupId });
      return;
    }
    if (
      config.defaultReplyMode === "mention" &&
      !this.isMentioned(event)
    ) {
      return;
    }
    await this.replyToMessage(event, config, traceId);
  }

  isMentioned(event) {
    const segments = Array.isArray(event.message) ? event.message : [];
    return segments.some((segment) => {
      if (!segment || typeof segment !== "object") return false;
      if (segment.type === "at") return true;
      if (segment.type === "reply") return true;
      return false;
    });
  }

  extractText(event) {
    if (typeof event.text === "string" && event.text.trim()) {
      return event.text.trim();
    }
    if (Array.isArray(event.message)) {
      const text = event.message
        .filter((segment) => segment?.type === "text")
        .map((segment) => segment.data?.text || "")
        .join("");
      if (text.trim()) return text.trim();
    }
    return String(event.raw_message || "").trim();
  }

  eventActor(event) {
    if (event.actor) return event.actor;
    return {
      id: String(event.user_id ?? ""),
      origin: "qq",
      roles: event.sender?.role ? [event.sender.role] : [],
    };
  }

  eventScene(event) {
    if (event.scene) return event.scene;
    return {
      type: event.message_type,
      id: String(event.group_id ?? event.user_id ?? ""),
    };
  }

  actionContext(sceneType, sceneId, traceId) {
    return {
      actor: {
        origin: "system",
        id: "ai-bot",
        admin: true,
        roles: ["admin"],
      },
      scene: {
        type: sceneType,
        id: String(sceneId),
      },
      traceId,
    };
  }

  async replyToMessage(event, config, traceId) {
    const sceneKey =
      event.message_type === "group"
        ? `group:${event.group_id}`
        : `private:${event.user_id}`;
    const now = Date.now();
    const cooldownMs = (config.cooldownSeconds || 0) * 1000;
    const nextAllowedAt = this.cooldowns.get(sceneKey) || 0;
    if (cooldownMs > 0 && now < nextAllowedAt) return;

    const text = this.extractText(event);
    if (!text) return;
    const llmResult = await this.ctx.registry.invoke("llm-bridge", {
      action: "chat",
      params: {
        messages: [
          { role: "system", content: config.systemPrompt || "" },
          { role: "user", content: text },
        ],
        temperature: 0.8,
        max_tokens: 512,
        ...(config.llmProvider ? { provider: config.llmProvider } : {}),
        ...(config.llmModel ? { model: config.llmModel } : {}),
      },
      context: {
        actor: this.eventActor(event),
        scene: this.eventScene(event),
        traceId,
      },
    });
    const rawReply =
      llmResult?.data?.choices?.[0]?.message?.content ||
      llmResult?.data?.choices?.[0]?.text ||
      "";
    const reply = String(rawReply || "").trim();
    if (!reply) {
      this.log.info("ai", "empty llm reply", { traceId });
      return;
    }
    const limited = reply.slice(0, config.maxReplyLength || 2000);
    const action =
      event.message_type === "group" ? "send_group_msg" : "send_private_msg";
    const params =
      event.message_type === "group"
        ? {
            group_id: String(event.group_id),
            message: [{ type: "text", data: { text: limited } }],
          }
        : {
            user_id: String(event.user_id),
            message: [{ type: "text", data: { text: limited } }],
          };
    const sceneId =
      event.message_type === "group" ? event.group_id : event.user_id;
    await this.ctx.registry.invoke("action-qq", {
      action,
      params,
      context: this.actionContext(event.message_type, sceneId, traceId),
    });
    this.cooldowns.set(sceneKey, now + cooldownMs);
    this.log.info("ai", "reply sent", {
      traceId,
      sceneType: event.message_type,
      sceneId: String(sceneId),
      length: limited.length,
    });
  }

  async tryHandlePrivateCommand(event, config, traceId) {
    const text = this.extractText(event);
    if (!/^\/ai(?:\s|$)/i.test(text)) return false;
    const userId = String(event.user_id || "");
    const adminIds = (config.adminUserIds || []).map(String);
    if (!adminIds.includes(userId)) {
      await this.sendPrivateText(userId, "你没有权限执行 AI Bot 管理指令", traceId);
      return true;
    }

    const parts = text.split(/\s+/);
    const command = (parts[1] || "help").toLowerCase();
    const arg = parts.slice(2).join(" ").trim();

    if (command === "help") {
      await this.sendPrivateText(
        userId,
        [
          "/ai status",
          "/ai on <groupId>",
          "/ai off <groupId>",
          "/ai mode mention|all",
          "/ai default on|off",
          "/ai prompt <text>",
        ].join("\n"),
        traceId,
      );
      return true;
    }
    if (command === "status") {
      await this.sendPrivateText(
        userId,
        [
          `默认启用: ${config.defaultEnabled}`,
          `私聊回复: ${config.privateEnabled}`,
          `回复模式: ${config.defaultReplyMode}`,
          `启用群: ${(config.enabledGroups || []).join(", ") || "无"}`,
          `禁用群: ${(config.disabledGroups || []).join(", ") || "无"}`,
          `管理员: ${(config.adminUserIds || []).join(", ") || "无"}`,
        ].join("\n"),
        traceId,
      );
      return true;
    }
    if (command === "on" || command === "off") {
      if (!arg) {
        await this.sendPrivateText(userId, "用法: /ai on|off <groupId>", traceId);
        return true;
      }
      const groupId = arg;
      const enabledGroups = (config.enabledGroups || []).map(String);
      const disabledGroups = (config.disabledGroups || []).map(String);
      if (command === "on") {
        if (!enabledGroups.includes(groupId)) enabledGroups.push(groupId);
        const nextDisabled = disabledGroups.filter((id) => id !== groupId);
        await savePluginConfig(this.ctx, {
          enabledGroups,
          disabledGroups: nextDisabled,
        });
      } else {
        if (!disabledGroups.includes(groupId)) disabledGroups.push(groupId);
        const nextEnabled = enabledGroups.filter((id) => id !== groupId);
        await savePluginConfig(this.ctx, {
          enabledGroups: nextEnabled,
          disabledGroups,
        });
      }
      await this.sendPrivateText(
        userId,
        `群 ${groupId} 已${command === "on" ? "启用" : "禁用"}`,
        traceId,
      );
      return true;
    }
    if (command === "mode") {
      if (!["mention", "all"].includes(arg)) {
        await this.sendPrivateText(userId, "用法: /ai mode mention|all", traceId);
        return true;
      }
      await savePluginConfig(this.ctx, { defaultReplyMode: arg });
      await this.sendPrivateText(userId, `回复模式已设为 ${arg}`, traceId);
      return true;
    }
    if (command === "default") {
      if (arg !== "on" && arg !== "off") {
        await this.sendPrivateText(userId, "用法: /ai default on|off", traceId);
        return true;
      }
      await savePluginConfig(this.ctx, { defaultEnabled: arg === "on" });
      await this.sendPrivateText(userId, `默认启用已设为 ${arg}`, traceId);
      return true;
    }
    if (command === "prompt") {
      if (!arg) {
        await this.sendPrivateText(userId, "用法: /ai prompt <text>", traceId);
        return true;
      }
      await savePluginConfig(this.ctx, { systemPrompt: arg });
      await this.sendPrivateText(userId, "系统提示词已更新", traceId);
      return true;
    }

    await this.sendPrivateText(userId, "未知指令，输入 /ai help 查看帮助", traceId);
    return true;
  }

  async sendPrivateText(userId, text, traceId) {
    await this.ctx.registry.invoke("action-qq", {
      action: "send_private_msg",
      params: {
        user_id: String(userId),
        message: [{ type: "text", data: { text } }],
      },
      context: this.actionContext("private", userId, traceId),
    });
  }

  async dispose() {
    this.disposed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.log.info("index", "disposed");
    await this.log.flush();
    await this.log.unregister();
  }
}
