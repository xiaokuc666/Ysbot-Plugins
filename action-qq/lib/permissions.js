import {
  ADMIN_ONLY_ACTIONS,
  OWNER_ONLY_ACTIONS,
  isRestrictedAction,
  isWriteAction,
} from "./actions.js";
import { ERROR_CODES, QqActionError } from "./errors.js";

const ROLE_ORDER = {
  owner: 3,
  admin: 2,
  member: 1,
};

const GROUP_TARGET_ACTIONS = new Set([
  "send_group_msg",
  "send_group_forward_msg",
  "set_group_card",
  "set_group_name",
  "set_group_ban",
  "set_group_whole_ban",
  "set_group_kick",
  "set_group_admin",
  "set_group_special_title",
]);

const TARGET_USER_ACTIONS = new Set([
  "set_group_card",
  "set_group_ban",
  "set_group_kick",
  "set_group_admin",
  "set_group_special_title",
]);

function normalizeRole(value) {
  const role = String(value || "").toLowerCase();
  if (role === "owner" || role === "群主") return "owner";
  if (role === "admin" || role === "管理员") return "admin";
  return "member";
}

export function actorRole(actor) {
  if (!actor) return "member";
  const raw = actor.role || (Array.isArray(actor.roles) ? actor.roles[0] : null);
  if (raw) return normalizeRole(raw);
  return actor.admin === true || actor.isAdmin === true ? "admin" : "member";
}

export function targetRoleFrom(params = {}, context = {}) {
  const raw =
    context.target?.role ||
    context.targetRole ||
    params.targetRole ||
    params.role;
  return raw ? normalizeRole(raw) : null;
}

function deny(action, message) {
  throw new QqActionError(ERROR_CODES.PERMISSION_DENIED, message, { action });
}

function requireActorScene(action, context) {
  if (!context?.actor?.id || !context?.scene?.id) {
    throw new QqActionError(
      ERROR_CODES.INVALID_CONTEXT,
      `${action} requires actor and scene`,
      { action },
    );
  }
}

function isOwnMessage(params = {}, context = {}) {
  const ownerId = String(
    params.messageOwnerId ??
      params.sender_id ??
      context.messageOwnerId ??
      context.target?.id ??
      "",
  );
  return Boolean(ownerId && ownerId === String(context.actor?.id || ""));
}

function assertGroupTarget(action, params, context) {
  if (context.scene?.type !== "group") {
    deny(action, `${action} requires a group scene`);
  }
  if (String(params.group_id) !== String(context.scene.id)) {
    deny(action, `${action} target does not match scene`);
  }
}

function assertAdminCanManageTarget(action, actor, params, context) {
  const role = actorRole(actor);
  if (role === "owner") return;
  const targetRole = targetRoleFrom(params, context);
  if (targetRole !== "member") {
    deny(action, `${action} requires owner permission for this target`);
  }
}

export function assertActionPermission(action, params = {}, context = {}, config = {}) {
  if (isWriteAction(action) && action !== "send_like") {
    requireActorScene(action, context);
  }
  if (action === "send_like" && !context?.actor?.id) {
    throw new QqActionError(
      ERROR_CODES.INVALID_CONTEXT,
      "send_like requires actor",
      { action },
    );
  }

  if (GROUP_TARGET_ACTIONS.has(action)) {
    assertGroupTarget(action, params, context);
  }
  if (action === "send_msg") {
    if (params.message_type === "group" || params.group_id !== undefined) {
      assertGroupTarget(action, params, context);
    } else if (params.message_type === "private" || params.user_id !== undefined) {
      if (context.scene?.type !== "private") {
        deny(action, "send_msg requires a private scene");
      }
      if (String(params.user_id) !== String(context.scene.id)) {
        deny(action, "send_msg target does not match scene");
      }
    } else {
      deny(action, "send_msg requires a valid target");
    }
  }
  if (action === "send_private_msg") {
    if (context.scene?.type !== "private") {
      deny(action, "send_private_msg requires a private scene");
    }
    if (String(params.user_id) !== String(context.scene.id)) {
      deny(action, "send_private_msg target does not match scene");
    }
  }
  if (action === "set_group_add_request" && context.scene?.type !== "group") {
    deny(action, "set_group_add_request requires a group scene");
  }

  const role = actorRole(context.actor);
  if (action === "delete_msg" && isOwnMessage(params, context)) return;
  if (
    action === "delete_msg" &&
    role === "member" &&
    !isOwnMessage(params, context) &&
    context.approved !== true
  ) {
    deny(action, "delete_msg requires owner or admin permission");
  }
  if (OWNER_ONLY_ACTIONS.includes(action) && role !== "owner") {
    deny(action, `${action} requires group owner`);
  } else if (
    ADMIN_ONLY_ACTIONS.includes(action) &&
    role !== "owner" &&
    role !== "admin"
  ) {
    deny(action, `${action} requires admin or owner`);
  } else if (isRestrictedAction(action)) {
    if (role !== "owner" && role !== "admin" && context.approved !== true) {
      deny(action, `${action} requires admin or explicit approval`);
    }
  }

  if (action === "delete_msg") {
    if (isOwnMessage(params, context)) return;
    if (role === "owner") return;
    if (role === "admin") {
      assertAdminCanManageTarget(action, context.actor, params, context);
      return;
    }
    deny(action, "delete_msg requires owner or admin permission");
  }

  if (TARGET_USER_ACTIONS.has(action)) {
    assertAdminCanManageTarget(action, context.actor, params, context);
  }
}
