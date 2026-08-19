import fs from "node:fs/promises";
import path from "node:path";
import { assertActionSupported } from "./lib/actions.js";
import { createChatStore, messageToText } from "./lib/chat-store.js";
import { loadPluginConfig } from "./lib/config.js";
import { ERROR_CODES, QqActionError, toQqActionError } from "./lib/errors.js";
import { createPluginLogger } from "./lib/logger.js";
import { validateManagementParams } from "./lib/management.js";
import { assertActionPermission } from "./lib/permissions.js";
import { QqApi } from "./lib/qq-api.js";
import { assertMessageLength, normalizeMessage } from "./lib/segments.js";

const ADMIN_PATH = "/api/plugins/action-qq/admin";
const TARGET_USER_ACTIONS = new Set([
  "set_group_card",
  "set_group_ban",
  "set_group_kick",
  "set_group_admin",
  "set_group_special_title",
]);

function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default class ActionQqPlugin {
  async init(ctx) {
    this.ctx = ctx;
    this.disposed = false;
    this.config = await loadPluginConfig(ctx);
    this.log = await createPluginLogger(ctx);
    this.chat = await createChatStore({
      dataDir: ctx.dataDir,
      logger: this.log,
    });
    this.qq = new QqApi({ registry: ctx.registry });
    this.contactsCache = null;
    this.roleCache = new Map();
    this.status = {
      startedAt: new Date().toISOString(),
      actionsSent: 0,
      actionsFailed: 0,
      lastError: null,
    };
    this.registerRoutes(ctx.api);
    this.unsubscribeChat = ctx.eventBus.on("onebot.message", (event) => {
      if (event.message_type === "group" || event.message_type === "private") {
        this.chat.capture(event);
      }
    });
  }

  registerRoutes(api) {
    this.cleanupRoutes(api);
    const register = (method, routePath, handler) => {
      api[method.toLowerCase()](routePath, (helpers) => handler.call(this, helpers));
      const route = api.routes[api.routes.length - 1];
      if (route) route._actionQq = true;
    };
    register("GET", `${ADMIN_PATH}/status`, this.handleStatusHtml);
    register("GET", `${ADMIN_PATH}/status.json`, this.handleStatusJson);
    register("GET", `${ADMIN_PATH}/chat`, this.handleChatHtml);
    register("GET", `${ADMIN_PATH}/chat/scenes`, this.handleChatScenes);
    register("GET", `${ADMIN_PATH}/chat/contacts`, this.handleChatContacts);
    register("GET", `${ADMIN_PATH}/chat/messages`, this.handleChatMessages);
    register("POST", `${ADMIN_PATH}/chat/send`, this.handleChatSend);
    register("POST", `${ADMIN_PATH}/chat/delete`, this.handleChatDelete);
    register("POST", `${ADMIN_PATH}/chat/clear`, this.handleChatClear);
    register("POST", `${ADMIN_PATH}/chat/resolve-role`, this.handleResolveRole);
    register("GET", `${ADMIN_PATH}/chat/manager/overview`, this.handleManagerOverview);
    register("GET", `${ADMIN_PATH}/chat/manager/members`, this.handleManagerMembers);
    register("POST", `${ADMIN_PATH}/chat/manager/quit-group`, this.handleManagerQuitGroup);
    register("POST", `${ADMIN_PATH}/chat/manager/delete-friend`, this.handleManagerDeleteFriend);
    register("POST", `${ADMIN_PATH}/chat/manager/handle-group-request`, this.handleManagerGroupRequest);
    register("POST", `${ADMIN_PATH}/chat/manager/handle-friend-request`, this.handleManagerFriendRequest);
    register("POST", `${ADMIN_PATH}/chat/manager/kick`, this.handleManagerKick);
    register("POST", `${ADMIN_PATH}/chat/manager/mute`, this.handleManagerMute);
    register("POST", `${ADMIN_PATH}/chat/manager/mute-all`, this.handleManagerMuteAll);
    register("POST", `${ADMIN_PATH}/chat/manager/resolve-roles`, this.handleManagerResolveRoles);
  }

  cleanupRoutes(api) {
    if (!api?.routes) return;
    api.routes = api.routes.filter((route) => {
      if (route._actionQq) return false;
      return !String(route.path || "").startsWith(`${ADMIN_PATH}/`);
    });
  }

  async handleStatusHtml({ sendHtml }) {
    if (this.disposed) {
      sendHtml(
        503,
        '<!doctype html><html><body style="font-family:sans-serif;padding:24px"><h1>QQ Action 已禁用</h1></body></html>',
      );
      return;
    }
    sendHtml(200, await this.readPublic("status-page.html"));
  }

  async handleStatusJson({ sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    sendJson(200, { ok: true, status: this.snapshot() });
  }

  async handleChatHtml({ sendHtml }) {
    if (this.disposed) {
      sendHtml(503, "<h1>QQ 聊天已禁用</h1>");
      return;
    }
    sendHtml(200, await this.readPublic("chat-page.html"));
  }

  async handleChatScenes({ sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    sendJson(200, { ok: true, scenes: this.chat.listScenes() });
  }

  async handleChatContacts({ url, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    sendJson(200, {
      ok: true,
      ...(await this.loadContacts(url.searchParams.get("force") === "1")),
    });
  }

  async handleResolveRole({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const groupId = String(body?.sceneId ?? body?.groupId ?? "");
    if (!groupId) {
      const error = new Error("groupId is required");
      error.statusCode = 400;
      throw error;
    }
    const role = await this.resolveGroupRole(groupId);
    sendJson(200, { ok: true, groupId, role });
  }

  async resolveGroupRole(groupId) {
    const target = String(groupId);
    const cached = this.roleCache.get(target);
    if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
      return cached.role;
    }
    let role = "member";
    try {
      const login = await this.invoke({
        action: "get_login_info",
        params: {},
        context: {},
      });
      const selfId = String(login.data?.user_id || "");
      const member = await this.qq.invoke(
        "get_group_member_info",
        {
          group_id: target,
          user_id: selfId,
          no_cache: true,
        },
        this.managementContext("group", target),
      );
      const rawRole = String(member?.data?.role || "").toLowerCase();
      role = rawRole === "owner" ? "owner" : rawRole === "admin" ? "admin" : "member";
    } catch {
      role = "member";
    }
    this.roleCache.set(target, { role, ts: Date.now() });
    return role;
  }

  async loadContacts(force = false) {
    if (
      !force &&
      this.contactsCache &&
      Date.now() - this.contactsCache.ts < 30000
    ) {
      return this.contactsCache.data;
    }
    const login = await this.invoke({
      action: "get_login_info",
      params: {},
      context: {},
    });
    const selfId = String(login.data?.user_id || "");
    const groupList = await this.invoke({
      action: "get_group_list",
      params: {},
      context: {},
    });
    const groups = [];
    for (const group of Array.isArray(groupList.data) ? groupList.data : []) {
      const groupId = String(group.group_id);
      if (this.chat.isSceneRemoved("group", groupId)) continue;
      const cachedRole = this.roleCache.get(groupId);
      groups.push({
        id: groupId,
        name: group.group_name || String(group.group_id),
        role: cachedRole?.role || "member",
      });
    }
    const friendList = await this.invoke({
      action: "get_friend_list",
      params: {},
      context: {},
    });
    const friends = (Array.isArray(friendList.data) ? friendList.data : [])
      .filter(
        (friend) =>
          !this.chat.isSceneRemoved("private", String(friend.user_id)),
      )
      .map((friend) => ({
        id: String(friend.user_id),
        nickname: friend.nickname || "",
        remark: friend.remark || "",
      }));
    const data = {
      selfId,
      groups,
      friends,
      updatedAt: new Date().toISOString(),
    };
    this.contactsCache = { ts: Date.now(), data };
    return data;
  }

  async handleChatMessages({ url, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const sceneType = url.searchParams.get("sceneType");
    const sceneId = url.searchParams.get("sceneId");
    if (!sceneType || !sceneId) {
      const error = new Error("sceneType and sceneId are required");
      error.statusCode = 400;
      throw error;
    }
    const limit = Number(url.searchParams.get("limit")) || 200;
    sendJson(200, {
      ok: true,
      messages: this.chat.listMessages(sceneType, sceneId, limit),
    });
  }

  managementContext(sceneType, sceneId) {
    const actor = this.ctx.permissions?.managementActor
      ? this.ctx.permissions.managementActor()
      : {
          origin: "management",
          id: "management",
          admin: true,
          roles: ["admin"],
        };
    return {
      actor,
      scene: {
        type: sceneType,
        id: String(sceneId),
      },
      traceId: generateTraceId(),
    };
  }

  async handleChatSend({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const { sceneType, sceneId } = body || {};
    if (!["group", "private"].includes(sceneType) || !sceneId) {
      const error = new Error("sceneType and sceneId are required");
      error.statusCode = 400;
      throw error;
    }
    const message = body?.message !== undefined ? body.message : body?.text;
    if (message === undefined || message === null) {
      const error = new Error("message is required");
      error.statusCode = 400;
      throw error;
    }
    const segments = normalizeMessage(message);
    assertMessageLength(segments, this.config.maxMessageLength);
    const action = sceneType === "group" ? "send_group_msg" : "send_private_msg";
    const params =
      sceneType === "group"
        ? { group_id: String(sceneId), message: segments }
        : { user_id: String(sceneId), message: segments };
    const result = await this.invoke({
      action,
      params,
      context: {
        ...this.managementContext(sceneType, sceneId),
        skipChatRecord: true,
      },
    });
    const record = await this.chat.recordOutgoing({
      messageId: result.data?.message_id ?? `out-${Date.now()}`,
      sceneType,
      sceneId,
      segments,
      text: messageToText({ message: segments }),
    });
    sendJson(200, { ok: true, message: record });
  }

  async handleChatDelete({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const messageId = body?.messageId;
    if (messageId === undefined || messageId === null) {
      const error = new Error("messageId is required");
      error.statusCode = 400;
      throw error;
    }
    const record = this.chat.findByMessageId(messageId);
    if (!record) {
      const error = new Error("message not found in chat history");
      error.statusCode = 404;
      throw error;
    }
    const baseContext = this.managementContext(record.sceneType, record.sceneId);
    const deleteContext = {
      ...baseContext,
      messageOwnerId:
        record.direction === "out" ? record.senderId : undefined,
      target: {
        id: record.senderId,
        role: record.sender?.role || "member",
      },
    };
    await this.invoke({
      action: "delete_msg",
      params: { message_id: String(messageId) },
      context: deleteContext,
    });
    try {
      await this.invoke({
        action: "get_msg",
        params: { message_id: String(messageId) },
        context: baseContext,
      });
    } catch (error) {
      // get_msg 可能受本地缓存影响返回旧消息，delete_msg 成功即视为撤回成功。
    }
    await this.chat.markRecalled(messageId);
    sendJson(200, { ok: true, messageId: String(messageId) });
  }

  async handleChatClear({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const { sceneType, sceneId } = body || {};
    if (!sceneType || !sceneId) {
      const error = new Error("sceneType and sceneId are required");
      error.statusCode = 400;
      throw error;
    }
    await this.chat.clearScene(sceneType, String(sceneId));
    this.roleCache.delete(String(sceneId));
    if (this.contactsCache?.data) {
      if (sceneType === "group") {
        this.contactsCache.data.groups = this.contactsCache.data.groups.filter(
          (group) => String(group.id) !== String(sceneId),
        );
      } else {
        this.contactsCache.data.friends = this.contactsCache.data.friends.filter(
          (friend) => String(friend.id) !== String(sceneId),
        );
      }
    }
    sendJson(200, { ok: true, sceneType, sceneId: String(sceneId) });
  }

  async handleManagerOverview({ sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const contacts = await this.loadContacts();
    const [groupRequests, friendRequests] = await Promise.all([
      this.qq
        .invoke(
          "get_group_system_msg",
          { only_pending: true },
          this.managementContext("group", ""),
        )
        .then((result) => (Array.isArray(result.data) ? result.data : []))
        .catch(() => []),
      this.qq
        .invoke(
          "get_doubt_friends_add_request",
          {},
          this.managementContext("private", ""),
        )
        .then((result) => (Array.isArray(result.data) ? result.data : []))
        .catch(() => []),
    ]);
    sendJson(200, {
      ok: true,
      groups: contacts.groups,
      friends: contacts.friends,
      groupRequests,
      friendRequests,
    });
  }

  async handleManagerMembers({ url, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const groupId = url.searchParams.get("groupId");
    if (!groupId) {
      const error = new Error("groupId is required");
      error.statusCode = 400;
      throw error;
    }
    const result = await this.qq.invoke(
      "get_group_member_list",
      { group_id: groupId },
      this.managementContext("group", groupId),
    );
    sendJson(200, {
      ok: true,
      members: Array.isArray(result.data) ? result.data : [],
    });
  }

  async handleManagerQuitGroup({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const groupId = String(body?.groupId ?? "");
    if (!groupId) {
      const error = new Error("groupId is required");
      error.statusCode = 400;
      throw error;
    }
    await this.qq.invoke(
      "set_group_leave",
      { group_id: groupId },
      this.managementContext("group", groupId),
    );
    await this.chat.clearScene("group", groupId);
    sendJson(200, { ok: true, groupId });
  }

  async handleManagerDeleteFriend({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const userId = String(body?.userId ?? "");
    if (!userId) {
      const error = new Error("userId is required");
      error.statusCode = 400;
      throw error;
    }
    await this.qq.invoke(
      "delete_friend",
      { user_id: userId, block: false },
      this.managementContext("private", userId),
    );
    await this.chat.clearScene("private", userId);
    sendJson(200, { ok: true, userId });
  }

  async handleManagerGroupRequest({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const { flag, sub_type = "add", approve = true, reason = "" } = body || {};
    if (!flag) {
      const error = new Error("flag is required");
      error.statusCode = 400;
      throw error;
    }
    await this.qq.invoke(
      "set_group_add_request",
      { flag, sub_type, approve, reason },
      this.managementContext("group", ""),
    );
    sendJson(200, { ok: true, flag, approve });
  }

  async handleManagerFriendRequest({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const { flag, approve = true } = body || {};
    if (!flag) {
      const error = new Error("flag is required");
      error.statusCode = 400;
      throw error;
    }
    await this.qq.invoke(
      "set_doubt_friends_add_request",
      { flag, approve },
      this.managementContext("private", ""),
    );
    sendJson(200, { ok: true, flag, approve });
  }

  async handleManagerKick({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const { groupId, userId, rejectAddRequest = false } = body || {};
    if (!groupId || !userId) {
      const error = new Error("groupId and userId are required");
      error.statusCode = 400;
      throw error;
    }
    const context = this.managementContext("group", groupId);
    try {
      await this.qq.invoke(
        "set_group_kick",
        {
          group_id: String(groupId),
          user_id: String(userId),
          reject_add_request: rejectAddRequest,
        },
        context,
      );
    } catch (error) {
      const qqError = toQqActionError(error, "set_group_kick");
      if (qqError.code === ERROR_CODES.ONEBOT_FAILED) {
        let stillInGroup = true;
        try {
          stillInGroup = await this.isGroupMemberPresent(groupId, userId, context);
        } catch {
          // Verification failed; keep the original protocol error.
        }
        if (!stillInGroup) {
          this.log.info("management", "kick recovered after protocol error", {
            groupId: String(groupId),
            userId: String(userId),
            wording: qqError.wording ?? null,
          });
          sendJson(200, { ok: true, groupId, userId, recovered: true });
          return;
        }
      }
      throw qqError;
    }
    sendJson(200, { ok: true, groupId, userId });
  }

  async isGroupMemberPresent(groupId, userId, context) {
    const result = await this.qq.invoke(
      "get_group_member_list",
      {
        group_id: String(groupId),
        no_cache: true,
      },
      context,
    );
    const members = Array.isArray(result?.data) ? result.data : [];
    return members.some((member) => String(member.user_id) === String(userId));
  }

  async handleManagerMute({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const { groupId, userId, duration = 600 } = body || {};
    if (!groupId || !userId) {
      const error = new Error("groupId and userId are required");
      error.statusCode = 400;
      throw error;
    }
    await this.qq.invoke(
      "set_group_ban",
      {
        group_id: String(groupId),
        user_id: String(userId),
        duration: Number(duration),
      },
      this.managementContext("group", groupId),
    );
    sendJson(200, { ok: true, groupId, userId, duration });
  }

  async handleManagerMuteAll({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const { groupId, duration = 600 } = body || {};
    if (!groupId) {
      const error = new Error("groupId is required");
      error.statusCode = 400;
      throw error;
    }
    const members = await this.qq.invoke(
      "get_group_member_list",
      { group_id: String(groupId) },
      this.managementContext("group", groupId),
    );
    const ordinary = (Array.isArray(members.data) ? members.data : []).filter(
      (member) => member.role !== "owner" && member.role !== "admin",
    );
    let muted = 0;
    for (const member of ordinary) {
      await this.qq.invoke(
        "set_group_ban",
        {
          group_id: String(groupId),
          user_id: String(member.user_id),
          duration: Number(duration),
        },
        this.managementContext("group", groupId),
      );
      muted += 1;
    }
    sendJson(200, { ok: true, groupId, duration, muted });
  }

  async handleManagerResolveRoles({ sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "action-qq is disabled" });
      return;
    }
    const contacts = await this.loadContacts();
    const manageable = [];
    for (const group of contacts.groups) {
      const role = await this.resolveGroupRole(group.id);
      if (role === "owner" || role === "admin") {
        manageable.push({ ...group, role });
      }
    }
    sendJson(200, { ok: true, groups: manageable });
  }

  snapshot() {
    const protocol = this.ctx.registry.get("protocol-onebot");
    return {
      ...this.status,
      disposed: this.disposed,
      protocolOnebot: Boolean(protocol && protocol.enabled !== false),
    };
  }

  async readPublic(name) {
    const file = path.join(this.ctx.pluginDir, "public", name);
    try {
      return await fs.readFile(file, "utf8");
    } catch {
      return "<h1>Status page not found</h1>";
    }
  }

  prepareParams(action, params = {}) {
    const next = { ...params };
    if (action === "send_msg") {
      const validated = validateManagementParams(action, next);
      if (validated.message) {
        validated.message = normalizeMessage(validated.message);
        assertMessageLength(validated.message, this.config.maxMessageLength);
      }
      return validated;
    }
    if (action === "send_group_msg") {
      if (next.group_id === undefined || next.group_id === null) {
        throw new QqActionError(
          ERROR_CODES.INVALID_CONTEXT,
          "send_group_msg requires group_id",
          { action },
        );
      }
      next.message = normalizeMessage(next.message);
      assertMessageLength(next.message, this.config.maxMessageLength);
      return validateManagementParams(action, next);
    }
    if (action === "send_private_msg") {
      if (next.user_id === undefined || next.user_id === null) {
        throw new QqActionError(
          ERROR_CODES.INVALID_CONTEXT,
          "send_private_msg requires user_id",
          { action },
        );
      }
      next.message = normalizeMessage(next.message);
      assertMessageLength(next.message, this.config.maxMessageLength);
      return validateManagementParams(action, next);
    }
    if (action === "delete_msg" && next.message_id === undefined) {
      throw new QqActionError(
        ERROR_CODES.INVALID_CONTEXT,
        "delete_msg requires message_id",
        { action },
      );
    }
    return validateManagementParams(action, next);
  }

  async resolveTargetContext(action, params = {}, context = {}) {
    const next = { ...context };
    if (
      TARGET_USER_ACTIONS.has(action) &&
      params.user_id &&
      !next.target?.role &&
      !params.targetRole
    ) {
      try {
        const result = await this.qq.invoke(
          "get_group_member_info",
          {
            group_id: params.group_id,
            user_id: params.user_id,
            no_cache: true,
          },
          this.managementContext("group", params.group_id),
        );
        next.target = {
          id: String(params.user_id),
          role: result?.data?.role || "member",
        };
      } catch {
        next.target = { id: String(params.user_id), role: "member" };
      }
    }
    if (
      action === "delete_msg" &&
      params.message_id &&
      !next.messageOwnerId &&
      !next.target
    ) {
      const sceneType = next.scene?.type === "private" ? "private" : "group";
      try {
        const result = await this.qq.invoke(
          "get_msg",
          { message_id: params.message_id },
          this.managementContext(sceneType, next.scene?.id || ""),
        );
        const senderId = String(
          result?.data?.user_id ??
            result?.data?.sender?.user_id ??
            result?.data?.sender?.id ??
            "",
        );
        next.messageOwnerId = senderId;
        next.target = {
          id: senderId,
          role: result?.data?.sender?.role || "member",
        };
      } catch {
        // Leave target unknown; permission checks will reject unsafe recall.
      }
    }
    return next;
  }

  async invoke(params = {}, callContext = {}) {
    const action = params?.action;
    const rawParams = params?.params || {};
    const context = {
      ...callContext,
      ...(params?.context || {}),
    };
    const traceId = context.traceId || params?.traceId || generateTraceId();
    const contextWithTrace = { ...context, traceId };

    try {
      assertActionSupported(action, this.config);
      const qqParams = this.prepareParams(action, rawParams);
      const permissionContext = await this.resolveTargetContext(
        action,
        qqParams,
        contextWithTrace,
      );
      assertActionPermission(action, qqParams, permissionContext, this.config);
      const result = await this.qq.invoke(action, qqParams, contextWithTrace);
      this.status.actionsSent += 1;
      this.status.lastError = null;
      if (
        !contextWithTrace.skipChatRecord &&
        (action === "send_group_msg" || action === "send_private_msg")
      ) {
        await this.recordOutgoingAction(action, qqParams, result);
      }
      this.log.info("actions", `${action} ok`, {
        action,
        traceId,
        target: this.targetSummary(action, qqParams),
        messageId: result?.data?.message_id ?? null,
      });
      return {
        ok: true,
        action,
        data: result?.data ?? result,
      };
    } catch (error) {
      const qqError = toQqActionError(error, action || null);
      this.status.actionsFailed += 1;
      this.status.lastError = qqError.message;
      this.log.warn("actions", `${action || "unknown"} failed: ${qqError.message}`, {
        action: action || null,
        traceId,
        code: qqError.code,
      }, qqError);
      throw qqError;
    }
  }

  async recordOutgoingAction(action, qqParams, result) {
    const sceneType = action === "send_group_msg" ? "group" : "private";
    const sceneId = String(
      action === "send_group_msg"
        ? qqParams.group_id
        : qqParams.user_id,
    );
    if (!sceneId || sceneId === "undefined") return null;
    const message = qqParams.message;
    const text =
      typeof message === "string"
        ? message
        : messageToText({ message });
    try {
      return await this.chat.recordOutgoing({
        messageId:
          result?.data?.message_id ??
          result?.message_id ??
          `out-${Date.now()}`,
        sceneType,
        sceneId,
        segments: message,
        text,
      });
    } catch (error) {
      this.log.warn("chat", `outgoing record failed: ${error.message}`);
      return null;
    }
  }

  targetSummary(action, params = {}) {
    if (action === "send_group_msg") return String(params.group_id);
    if (action === "send_private_msg") return String(params.user_id);
    if (action === "delete_msg") return String(params.message_id);
    if (
      action === "send_group_forward_msg" ||
      action.startsWith("set_group_") ||
      action.endsWith("_add_request")
    ) {
      return String(params.group_id || params.flag || params.user_id || "");
    }
    return null;
  }

  async dispose() {
    this.disposed = true;
    if (this.unsubscribeChat) {
      this.unsubscribeChat();
      this.unsubscribeChat = null;
    }
    this.cleanupRoutes(this.ctx?.api);
    this.status.disposed = true;
    this.status.lastError = "disposed";
    this.log.info("index", "disposed");
    await this.chat?.flush();
    await this.log.unregister();
  }
}
