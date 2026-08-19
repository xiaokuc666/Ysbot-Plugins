import {
  groupEnabled,
  loadPluginConfig,
  savePluginConfig,
} from "./lib/config.js";
import { createHistoryStore } from "./lib/history.js";
import { createPluginLogger } from "./lib/logger.js";

function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function formatTime(date, timeZone = "Asia/Shanghai") {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function eventMessageKey(event = {}) {
  return String(
    event._aiBotMessageKey ??
      event.raw?.message_id ??
      event.id ??
      event.message_id ??
      `${event.message_type}:${event.group_id ?? event.user_id}:${event.user_id}:${event.timestamp ?? Date.now()}:${event.raw_message ?? event.text ?? ""}`,
  );
}

function replyMode(value, fallback = "auto") {
  if (value === false) return "never";
  if (value === true) return "always";
  return ["auto", "always", "never"].includes(value)
    ? value
    : fallback;
}

function sanitizeChatText(raw, maxSentences = 2) {
  const text = String(raw || "")
    .replace(/[（(【\[][^）)】\]]{0,80}[）)】\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text.match(/[^。！？!?]+[。！？!?]*/g) || [];
  if (sentences.length > maxSentences) {
    return sentences.slice(0, maxSentences).join("").trim();
  }
  return text;
}

function parseReplyPlan(raw, maxSentences = 2) {
  const rawText = String(raw || "").trim();
  if (!rawText) return [];
  let parsed = null;
  try {
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = null;
  }
  let items = [];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (Array.isArray(parsed?.messages)) {
    items = parsed.messages;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Object.hasOwn(parsed, "text")
  ) {
    items = [parsed];
  }
  if (!items.length) items = [rawText];
  return items
    .map((item) => {
      if (typeof item === "string") {
        return {
          text: sanitizeChatText(item, maxSentences),
          at: "",
          replyTo: "",
        };
      }
      if (!item || typeof item !== "object") return null;
      return {
        text: sanitizeChatText(item.text || "", maxSentences),
        at: String(item.at || "").trim(),
        replyTo: String(item.replyTo || "").trim(),
      };
    })
    .filter((item) => item && item.text);
}

export default class AiBotPlugin {
  async init(ctx) {
    this.ctx = ctx;
    this.disposed = false;
    this.config = await loadPluginConfig(ctx);
    this.log = await createPluginLogger(ctx);
    this.history = createHistoryStore({
      dataDir: ctx.dataDir,
      maxEntries: this.config.historyMaxEntries || 20,
      maxAgeMs: this.config.historyMaxAgeMs || 3600000,
    });
    this.cooldowns = new Map();
    this.directAttentionUntil = new Map();
    this.directAttentionLastFollow = new Map();
    this.lastProactiveAt = new Map();
    this.lastHumanMessageAt = new Map();
    this.seenGroups = new Set();
    this.periodicTimer = null;
    this.unsubscribe = ctx.eventBus.on("onebot.message", (event) => {
      this.handleMessage(event).catch((error) => {
        this.log.warn("ai", `event handling failed: ${error.message}`, {
          traceId: event?.traceId || null,
        });
      });
    });
    this.unsubscribeMotivation = ctx.eventBus.on(
      "curiosity.motivation",
      (motivation) => {
        this.handleCuriosityMotivation(motivation).catch((error) => {
          this.log.warn("ai", `curiosity motivation failed: ${error.message}`, {
            traceId: motivation?.payload?.traceId || null,
          });
        });
      },
    );
    this.unsubscribeDecision = ctx.eventBus.on(
      "curiosity.decision",
      (decision) => {
        this.handleCuriosityDecision(decision).catch((error) => {
          this.log.warn("ai", `curiosity decision failed: ${error.message}`, {
            traceId: decision?.motivation?.payload?.traceId || null,
          });
        });
      },
    );
    this.schedulePeriodicProbe();
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
      await this.appendIncomingHistory(event, config);
      await this.replyToMessage(event, config, traceId);
      return;
    }

    const groupId = String(event.group_id || "");
    if (!groupId) return;
    this.seenGroups.add(groupId);
    if (!groupEnabled(config, groupId)) {
      this.log.debug("ai", "group disabled", { traceId, groupId });
      return;
    }
    this.lastHumanMessageAt.set(groupId, Date.now());
    if (config.curiosityEnabled && this.ctx.curiosity) {
      await this.appendIncomingHistory(event, config);
      await this.submitCuriosity(event, config, traceId);
      return;
    }
    if (
      config.defaultReplyMode === "mention" &&
      !this.isMentioned(event)
    ) {
      return;
    }
    await this.appendIncomingHistory(event, config);
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

  async submitCuriosity(event, config, traceId) {
    const groupId = String(event.group_id || "");
    const isDirect = this.isMentioned(event);
    if (isDirect) {
      this.directAttentionUntil.set(
        groupId,
        Date.now() + (config.activeConversationIdleMs || 120000),
      );
      return this.submitMotivation({
        type: "direct_interaction",
        groupId,
        cooldownMs: config.curiosityDirectCooldownMs,
        shouldAct: true,
        event,
        traceId,
      }, config);
    }

    const now = Date.now();
    const attentionUntil = this.directAttentionUntil.get(groupId) || 0;
    if (now < attentionUntil) {
      this.directAttentionUntil.set(
        groupId,
        now + (config.directAttentionWindowMs || 30000),
      );
      const last = this.directAttentionLastFollow.get(groupId) || 0;
      const followCooldown = Math.max(
        1000,
        Number(config.directAttentionFollowCooldownMs) || 5000,
      );
      if (now - last >= followCooldown) {
        this.directAttentionLastFollow.set(groupId, now);
        const shouldAct =
          Math.random() <
          Number(config.directAttentionFollowProbability ?? 0.5);
        return this.submitMotivation({
          type: "direct_followup",
          groupId,
          cooldownMs: followCooldown,
          shouldAct,
          event,
          traceId,
        }, config);
      }
    }

    return this.submitMotivation({
      type: "group_active",
      groupId,
      cooldownMs: config.curiosityGroupActiveCooldownMs,
      shouldAct:
        Math.random() <
        Number(config.curiosityRandomReplyProbability || 0),
      event,
      traceId,
    }, config);
  }

  async submitMotivation(
    { type, groupId, cooldownMs, shouldAct, event, traceId },
    config,
  ) {
    const motivation = {
      type,
      groupId,
      cooldownMs,
      shouldAct,
      payload: { event, traceId },
    };
    this.log.debug("ai", "curiosity submit", {
      traceId,
      groupId: motivation.groupId,
      type,
      shouldAct,
      cooldownMs,
    });
    const decision = await this.ctx.curiosity.submit(motivation);
    if (!decision) {
      this.log.debug("ai", "curiosity cooldown hit", {
        traceId,
        groupId: motivation.groupId,
        type,
      });
    }
    return decision;
  }

  async handleCuriosityMotivation(motivation) {
    if (!motivation) return;
    this.log.debug("ai", "curiosity motivation", {
      traceId: motivation.payload?.traceId || null,
      groupId: motivation.groupId || null,
      type: motivation.type || null,
      shouldAct: motivation.shouldAct,
    });
  }

  async handleCuriosityDecision(decision) {
    if (!decision?.motivation) return;
    const config = await loadPluginConfig(this.ctx);
    if (!config.curiosityEnabled) return;
    const motivation = decision.motivation;
    const traceId = motivation.payload?.traceId || generateTraceId();
    this.log.info("ai", "curiosity decision", {
      traceId,
      groupId: motivation.groupId || null,
      type: motivation.type || null,
      shouldAct: decision.shouldAct,
    });
    if (!decision.shouldAct) {
      await this.observeMemory(motivation, traceId);
      return;
    }
    await this.replyFromMotivation(motivation, config, traceId);
  }

  async observeMemory(motivation, traceId) {
    const config = await loadPluginConfig(this.ctx);
    if (!config.curiosityMemoryEnabled) return;
    if (!this.hasPlugin("memory-store")) {
      this.log.debug("ai", "memory-store not installed; observe skipped", {
        traceId,
      });
      return;
    }
    try {
      await this.ctx.registry.invoke("memory-store", {
        action: "observe",
        params: { event: motivation.payload?.event || {} },
        context: {
          actor: this.botActor(),
          scene: {
            type: "group",
            id: String(motivation.groupId || ""),
          },
          traceId,
        },
      });
      this.log.info("ai", "memory observe written", { traceId });
    } catch (error) {
      this.log.warn("ai", `memory observe failed: ${error.message}`, {
        traceId,
      });
    }
  }

  async recallMemory(motivation, traceId) {
    const config = await loadPluginConfig(this.ctx);
    const scene = motivation?.payload?.event
      ? this.eventScene(motivation.payload.event)
      : { type: "group", id: String(motivation?.groupId || "") };
    return this.recallMemoryForScene(scene, null, config, traceId);
  }

  async recallMemoryForScene(scene, query, config, traceId) {
    if (
      !config.curiosityMemoryEnabled ||
      !this.hasPlugin("memory-store")
    ) {
      return null;
    }
    try {
      const result = await this.ctx.registry.invoke("memory-store", {
        action: "recall",
        params: {
          sceneType: "group",
          sceneId: scene?.id || "",
          groupId: scene?.id || "",
          query,
          limit: config.memoryRecallLimit || 10,
        },
        context: {
          actor: this.botActor(),
          scene: {
            type: scene?.type || "group",
            id: String(scene?.id || ""),
          },
          traceId,
        },
      });
      const data = result?.data;
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.entries)) return data.entries;
      if (Array.isArray(data?.memory)) return data.memory;
      return data || null;
    } catch (error) {
      this.log.warn("ai", `memory recall failed: ${error.message}`, {
        traceId,
      });
      return null;
    }
  }

  formatMemory(memory) {
    if (typeof memory === "string") return memory;
    if (Array.isArray(memory)) {
      return memory
        .map((entry) => {
          if (!entry) return "";
          return entry.text || entry.content || JSON.stringify(entry);
        })
        .filter(Boolean)
        .join("\n");
    }
    return JSON.stringify(memory);
  }

  hasPlugin(id) {
    const plugin = this.ctx.registry.get(id);
    return Boolean(plugin && plugin.enabled !== false && plugin.status === "ready");
  }

  botActor() {
    return {
      origin: "system",
      id: "ai-bot",
      admin: true,
      roles: ["admin"],
    };
  }

  managementActor() {
    return {
      origin: "management",
      id: "management",
      admin: true,
      roles: ["admin"],
    };
  }

  async replyFromMotivation(motivation, config, traceId) {
    let event = motivation?.payload?.event || {};
    if (!event.message_type && motivation?.groupId) {
      event = {
        ...event,
        message_type: "group",
        group_id: String(motivation.groupId),
      };
    }
    return this.generateAndSendReply(
      event,
      config,
      traceId,
      motivation?.type || "curiosity",
    );
  }

  buildEventContext(event, config = {}) {
    const segments = Array.isArray(event.message) ? event.message : [];
    const replySegment = segments.find((segment) => segment?.type === "reply");
    const atSegment = segments.find((segment) => segment?.type === "at");
    const now = new Date();
    const eventDate = event.timestamp
      ? new Date(Number(event.timestamp) * 1000)
      : now;
    return {
      message_type: event.message_type || null,
      group_id: event.group_id ? String(event.group_id) : null,
      group_name:
        event.raw?.group_name || event.group_name || null,
      user_id: event.user_id ? String(event.user_id) : null,
      nickname: event.sender?.nickname || event.sender?.card || "",
      card: event.sender?.card || "",
      role:
        event.sender?.role ||
        event.actor?.roles?.[0] ||
        "member",
      reply_to: replySegment?.data?.id
        ? String(replySegment.data.id)
        : null,
      at_bot: Boolean(atSegment),
      time: event.timestamp
        ? Number(event.timestamp)
        : Math.floor(now.getTime() / 1000),
      timeText: formatTime(eventDate, config.timeZone),
      nowText: formatTime(now, config.timeZone),
      timeAgoSeconds: Math.max(
        0,
        Math.floor((now.getTime() - eventDate.getTime()) / 1000),
      ),
    };
  }

  async loadIdentityContext(event, config, traceId) {
    if (!this.hasPlugin("identity-store")) return null;
    const scene = this.eventScene(event);
    try {
      const result = await this.ctx.registry.invoke("identity-store", {
        action: "context",
        params: {
          groupId:
            scene.type === "group" ? String(scene.id) : undefined,
          userId:
            scene.type === "private" ? String(scene.id) : undefined,
          query: this.extractText(event),
        },
        context: {
          actor: this.botActor(),
          scene,
          traceId,
        },
      });
      return result?.data || null;
    } catch (error) {
      this.log.warn("ai", `identity context failed: ${error.message}`, {
        traceId,
      });
      return null;
    }
  }

  async buildReplyContext(event, config, traceId) {
    const scene = this.eventScene(event);
    const sceneKey = `${scene.type}:${scene.id}`;
    const query = this.extractText(event);
    const memory = await this.recallMemoryForScene(
      scene,
      query,
      config,
      traceId,
    );
    const currentMessageKey = eventMessageKey(event);
    const history = (
      await this.history.list(sceneKey, {
        maxEntries: config.historyMaxEntries || 20,
        maxAgeMs: config.historyMaxAgeMs || 3600000,
      })
    ).filter(
      (entry) =>
        !currentMessageKey || entry.messageKey !== currentMessageKey,
    );
    const messages = [
      {
        role: "system",
        content: `${
          config.systemPrompt || ""
        }\n\nQQ群聊回复规则：\n- 回复保持简短，一次最多一到两句。\n- 不要使用括号描述动作、神态、环境。\n- 不要写“（笑）”“（点头）”“（歪头）”之类内容。\n- 直接输出聊天内容。\n- 普通回复直接输出文本。\n- 如果回复需要 @ 或引用，输出 JSON：{"text":"...","at":"用户QQ","replyTo":"消息ID"}。\n- 涉及群列表、好友列表、账号信息、成员信息等事实性问题时，必须调用对应工具，不得编造群名、昵称或数据。\n\n回复时不要添加“烟散：”“Bot：”之类的说话人前缀。`,
      },
    ];
    const identity = await this.loadIdentityContext(event, config, traceId);
    if (identity?.identityContext) {
      messages.push({
        role: "system",
        content: identity.identityContext,
      });
    }
    if (memory) {
      messages.push({
        role: "system",
        content: `近期记忆：\n${this.formatMemory(memory).slice(
          0,
          config.memoryMaxInjection || 2000,
        )}`,
      });
    }
    messages.push({
      role: "system",
      content: `当前事件上下文：\n${JSON.stringify(
        this.buildEventContext(event, config),
      )}`,
    });
    for (const entry of history) {
      const isBot =
        entry.role === "bot" || entry.userId === "bot"
      const role = isBot ? "assistant" : "user";
      const timeLabel = entry.ts
        ? `[${formatTime(new Date(entry.ts), config.timeZone)}] `
        : "";
      const content = isBot
        ? `${timeLabel}${String(entry.text || "")}`
        : entry.nickname
          ? `${timeLabel}${entry.nickname}: ${entry.text}`
          : `${timeLabel}${String(entry.text || "")}`;
      if (content) messages.push({ role, content });
    }
    messages.push({
      role: "user",
      content: query || "请根据当前群聊动态给出一个简短自然的回应。",
    });
    return {
      messages,
      scene,
      sceneKey,
      memoryCount: Array.isArray(memory)
        ? memory.length
        : memory
          ? 1
          : 0,
      historyCount: history.length,
      eventContext: this.buildEventContext(event, config),
    };
  }

  async appendHistory(scene, entry, config) {
    await this.history.append(
      {
        scene: {
          type: scene.type,
          id: String(scene.id),
        },
        ...entry,
      },
      {
        maxEntries: config.historyMaxEntries || 20,
        maxAgeMs: config.historyMaxAgeMs || 3600000,
      },
    );
  }

  async appendIncomingHistory(event, config) {
    if (!event?.user_id) return;
    event._aiBotMessageKey =
      event._aiBotMessageKey || eventMessageKey(event);
    const scene = this.eventScene(event);
    await this.appendHistory(
      scene,
      {
        userId: String(event.user_id),
        nickname: String(
          event.sender?.nickname ||
            event.sender?.card ||
            event.user_id ||
            "用户",
        ),
        role: String(event.sender?.role || "member"),
        text: this.extractText(event),
        messageKey: eventMessageKey(event),
      },
      config,
    );
  }

  buildReplySegments(event, text, config, plan = {}) {
    const segments = [];
    if (event.message_type === "group") {
      const replySegment = Array.isArray(event.message)
        ? event.message.find((segment) => segment?.type === "reply")
        : null;
      const quoteMode = replyMode(config.replyWithQuote);
      const atMode = replyMode(config.replyWithAt);
      const nickname =
        event.sender?.nickname || event.sender?.card || "";
      const directedToUser =
        (nickname && String(text).includes(nickname)) ||
        /(?:^|[\s，。！？])(?:你|您)/.test(String(text));
      const shouldQuote =
        quoteMode === "always" ||
        (quoteMode === "auto" &&
          Boolean(plan.replyTo || replySegment?.data?.id));
      const shouldAt =
        atMode === "always" ||
        (atMode === "auto" &&
          Boolean(plan.at || directedToUser));
      const replyTo = plan.replyTo || replySegment?.data?.id;
      const atTarget = plan.at || event.user_id;
      if (shouldQuote && replyTo) {
        segments.push({
          type: "reply",
          data: { id: String(replyTo) },
        });
      }
      if (shouldAt && atTarget) {
        segments.push({
          type: "at",
          data: { qq: String(atTarget) },
        });
      }
    }
    segments.push({ type: "text", data: { text } });
    return segments;
  }

  async generateAndSendReply(event, config, traceId, source = "message") {
    const context = await this.buildReplyContext(event, config, traceId);
    if (event.user_id && this.hasPlugin("identity-store")) {
      try {
        await this.ctx.registry.invoke("identity-store", {
          action: "journal",
          params: {
            scene: context.scene,
            userId: String(event.user_id),
            role: String(event.sender?.role || "member"),
            type: this.isMentioned(event) ? "mention" : "message",
            summary: this.extractText(event).slice(0, 200),
            tags: [],
          },
          context: {
            actor: this.botActor(),
            scene: context.scene,
            traceId,
          },
        });
      } catch (error) {
        this.log.warn("ai", `identity journal failed: ${error.message}`, {
          traceId,
        });
      }
    }
    this.log.info("ai", "context assembled", {
      traceId,
      sceneType: context.scene.type,
      sceneId: String(context.scene.id),
      source,
      memoryCount: context.memoryCount,
      historyCount: context.historyCount,
    });
    const llmResult = await this.ctx.registry.invoke("llm-bridge", {
      action: "chat",
      params: {
        messages: context.messages,
        tools: config.llmTools || [],
        executeTools: true,
        maxToolRounds: config.maxToolRounds || 3,
        temperature: 0.8,
        max_tokens: 512,
        ...(config.llmProvider ? { provider: config.llmProvider } : {}),
        ...(config.llmModel ? { model: config.llmModel } : {}),
      },
      context: {
        actor: this.botActor(),
        scene: context.scene,
        traceId,
      },
    });
    const rawReply =
      llmResult?.data?.choices?.[0]?.message?.content ||
      llmResult?.data?.choices?.[0]?.text ||
      llmResult?.data?.content ||
      "";
    const plan =
      parseReplyPlan(rawReply, config.maxReplySentences || 2)[0] || null;
    const fallbackReply = sanitizeChatText(
      rawReply,
      config.maxReplySentences || 2,
    );
    const reply = String(plan?.text || fallbackReply || "")
      .trim()
      .replace(/^(?:烟散|Bot|AI Bot|我)\s*[:：]\s*/i, "")
      .trim();
    if (!reply) {
      this.log.info("ai", "empty llm reply", { traceId, source });
      return null;
    }
    const limited = reply.slice(0, config.maxReplyLength || 2000);
    const message = this.buildReplySegments(
      event,
      limited,
      config,
      plan || {},
    );
    const action =
      event.message_type === "group" ? "send_group_msg" : "send_private_msg";
    const sceneId = event.group_id ?? event.user_id ?? context.scene.id;
    const params =
      action === "send_group_msg"
        ? {
            group_id: String(event.group_id ?? context.scene.id),
            message,
          }
        : {
            user_id: String(event.user_id ?? context.scene.id),
            message,
          };
    await this.ctx.registry.invoke("action-qq", {
      action,
      params,
      context: this.actionContext(
        event.message_type || context.scene.type,
        sceneId,
        traceId,
      ),
    });
    this.lastProactiveAt.set(String(context.scene.id), Date.now());
    await this.appendHistory(
      context.scene,
      {
        userId: "bot",
        nickname: "Bot",
        role: "bot",
        text: limited,
      },
      config,
    );
    const now = Date.now();
    this.cooldowns.set(
      context.sceneKey,
      now + (config.cooldownSeconds || 0) * 1000,
    );
    this.log.info("ai", "reply sent", {
      traceId,
      sceneType: context.scene.type,
      sceneId: String(context.scene.id),
      source,
      length: limited.length,
      toolRounds: Array.isArray(llmResult?.data?.toolTrace)
        ? llmResult.data.toolTrace.length
        : 0,
    });
    return {
      reply: limited,
      message,
      context,
      traceId,
      toolTrace: llmResult?.data?.toolTrace || [],
    };
  }

  async schedulePeriodicProbe() {
    if (this.disposed) return;
    const config = await loadPluginConfig(this.ctx);
    const enabled =
      config.curiosityEnabled &&
      config.curiosityPeriodicProbeEnabled &&
      Boolean(this.ctx.curiosity);
    const interval = enabled
      ? Math.max(
          10000,
          Number(config.curiosityPeriodicProbeIntervalMs) || 300000,
        )
      : 60000;
    this.periodicTimer = setTimeout(async () => {
      try {
        if (enabled) await this.runPeriodicProbe();
      } catch (error) {
        this.log.warn("ai", `periodic probe failed: ${error.message}`);
      } finally {
        this.schedulePeriodicProbe();
      }
    }, interval);
  }

  async runPeriodicProbe() {
    if (this.disposed) return;
    const config = await loadPluginConfig(this.ctx);
    if (
      !config.curiosityEnabled ||
      !config.curiosityPeriodicProbeEnabled ||
      !this.ctx.curiosity
    ) {
      return;
    }
    const groups = new Set([
      ...(config.enabledGroups || []).map(String),
      ...this.seenGroups,
    ]);
    const interval =
      config.curiosityPeriodicProbeIntervalMs || 300000;
    for (const groupId of groups) {
      if (!groupEnabled(config, groupId)) continue;
      if (this.isProactiveSilenced(groupId, config)) {
        this.log.debug("ai", "proactive silenced: waiting for human reply", {
          groupId,
        });
        continue;
      }
      const shouldAct =
        Math.random() <
        Number(config.curiosityPeriodicProbeProbability || 0);
      await this.ctx.curiosity.submit({
        type: "periodic_probe",
        groupId,
        cooldownMs: interval,
        shouldAct,
        payload: { traceId: generateTraceId(), source: "periodic" },
      });
    }
  }

  isProactiveSilenced(groupId, config) {
    if (config.proactiveSilenceEnabled === false) return false;
    const lastProactive = this.lastProactiveAt.get(String(groupId)) || 0;
    const lastHuman = this.lastHumanMessageAt.get(String(groupId)) || 0;
    return lastProactive > 0 && lastProactive > lastHuman;
  }

  async replyToMessage(event, config, traceId) {
    const scene = this.eventScene(event);
    const sceneKey = `${scene.type}:${scene.id}`;
    const now = Date.now();
    const cooldownMs = (config.cooldownSeconds || 0) * 1000;
    const nextAllowedAt = this.cooldowns.get(sceneKey) || 0;
    if (cooldownMs > 0 && now < nextAllowedAt) return;

    const text = this.extractText(event);
    if (!text) return;
    await this.generateAndSendReply(event, config, traceId, "message");
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
          "/ai memory <groupId>",
          "/ai memory clear <groupId>",
          "/ai note <groupId> <text>",
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
    if (command === "memory" || command === "note") {
      await this.handleMemoryAdminCommand(command, arg, userId, traceId);
      return true;
    }

    await this.sendPrivateText(userId, "未知指令，输入 /ai help 查看帮助", traceId);
    return true;
  }

  async handleMemoryAdminCommand(command, arg, userId, traceId) {
    if (!this.hasPlugin("memory-store")) {
      await this.sendPrivateText(
        userId,
        "memory-store 未安装，无法执行记忆指令。",
        traceId,
      );
      return;
    }
    const context = {
      actor: this.managementActor(),
      scene: { type: "private", id: String(userId) },
      traceId,
    };
    if (command === "memory" && arg.startsWith("clear ")) {
      const groupId = arg.slice("clear ".length).trim();
      if (!groupId) {
        await this.sendPrivateText(userId, "用法: /ai memory clear <groupId>", traceId);
        return;
      }
      const result = await this.ctx.registry.invoke("memory-store", {
        action: "clear",
        params: { groupId },
        context,
      });
      await this.sendPrivateText(
        userId,
        `已清空群 ${groupId} 的记忆，删除 ${result.data?.removed || 0} 条。`,
        traceId,
      );
      return;
    }
    if (command === "memory") {
      const groupId = arg.trim();
      if (!groupId) {
        await this.sendPrivateText(userId, "用法: /ai memory <groupId>", traceId);
        return;
      }
      const result = await this.ctx.registry.invoke("memory-store", {
        action: "list",
        params: { groupId, limit: 20 },
        context,
      });
      const entries = result.data?.entries || [];
      if (!entries.length) {
        await this.sendPrivateText(userId, `群 ${groupId} 暂无记忆。`, traceId);
        return;
      }
      const text = entries
        .slice(0, 10)
        .map((entry) => `${entry.ts} [${entry.type}] ${entry.content}`)
        .join("\n");
      await this.sendPrivateText(
        userId,
        `群 ${groupId} 共有 ${result.data?.total || 0} 条，最近：\n${text}`,
        traceId,
      );
      return;
    }
    if (command === "note") {
      const space = arg.indexOf(" ");
      if (space <= 0) {
        await this.sendPrivateText(userId, "用法: /ai note <groupId> <text>", traceId);
        return;
      }
      const groupId = arg.slice(0, space).trim();
      const content = arg.slice(space + 1).trim();
      await this.ctx.registry.invoke("memory-store", {
        action: "note",
        params: { groupId, content },
        context,
      });
      await this.sendPrivateText(userId, `已写入群 ${groupId} 的笔记。`, traceId);
    }
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
    this.directAttentionUntil.clear();
    this.directAttentionLastFollow.clear();
    this.lastProactiveAt.clear();
    this.lastHumanMessageAt.clear();
    if (this.periodicTimer) {
      clearTimeout(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.unsubscribeMotivation) {
      this.unsubscribeMotivation();
      this.unsubscribeMotivation = null;
    }
    if (this.unsubscribeDecision) {
      this.unsubscribeDecision();
      this.unsubscribeDecision = null;
    }
    this.log.info("index", "disposed");
    await this.log.flush();
    await this.log.unregister();
  }
}
