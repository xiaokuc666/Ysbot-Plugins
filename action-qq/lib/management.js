import { ERROR_CODES, QqActionError } from "./errors.js";
import { normalizeMessage } from "./segments.js";

function requireParam(params, key, action, message) {
  if (params[key] === undefined || params[key] === null) {
    throw new QqActionError(
      ERROR_CODES.INVALID_CONTEXT,
      `${action} requires ${message || key}`,
      { action },
    );
  }
}

function requireBoolean(params, key, action) {
  requireParam(params, key, action, `${key} boolean`);
  if (typeof params[key] !== "boolean") {
    throw new QqActionError(
      ERROR_CODES.INVALID_CONTEXT,
      `${action} requires ${key} to be a boolean`,
      { action },
    );
  }
}

function requireString(params, key, action, { allowEmpty = false } = {}) {
  requireParam(params, key, action, `${key} string`);
  if (typeof params[key] !== "string" || (!allowEmpty && params[key].trim() === "")) {
    throw new QqActionError(
      ERROR_CODES.INVALID_CONTEXT,
      `${action} requires ${key} to be a non-empty string`,
      { action },
    );
  }
}

function requireNonNegativeInteger(params, key, action) {
  requireParam(params, key, action, `${key} integer`);
  if (!Number.isInteger(Number(params[key])) || Number(params[key]) < 0) {
    throw new QqActionError(
      ERROR_CODES.INVALID_CONTEXT,
      `${action} requires ${key} to be a non-negative integer`,
      { action },
    );
  }
}

function normalizeForwardMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new QqActionError(
      ERROR_CODES.INVALID_MESSAGE,
      "send_group_forward_msg requires a non-empty messages array",
    );
  }
  return messages.map((node, index) => {
    if (!node || node.type !== "node" || !node.data || typeof node.data !== "object") {
      throw new QqActionError(
        ERROR_CODES.INVALID_MESSAGE,
        `forward node ${index} must be { type: "node", data: {...} }`,
      );
    }
    if (node.data.id !== undefined) {
      return { type: "node", data: { ...node.data } };
    }
    if (
      node.data.user_id === undefined ||
      node.data.nickname === undefined ||
      node.data.content === undefined
    ) {
      throw new QqActionError(
        ERROR_CODES.INVALID_MESSAGE,
        `forward node ${index} requires data.id or data.user_id/nickname/content`,
      );
    }
    const content = Array.isArray(node.data.content)
      ? normalizeMessage(node.data.content)
      : node.data.content;
    return {
      type: "node",
      data: {
        user_id: node.data.user_id,
        nickname: node.data.nickname,
        content,
      },
    };
  });
}

export function validateManagementParams(action, params = {}) {
  const next = { ...params };
  switch (action) {
    case "send_msg":
      requireString(next, "message_type", action);
      if (next.message_type === "group") {
        requireParam(next, "group_id", action, "group_id");
      } else if (next.message_type === "private") {
        requireParam(next, "user_id", action, "user_id");
      } else {
        throw new QqActionError(
          ERROR_CODES.INVALID_CONTEXT,
          `${action} requires message_type group or private`,
          { action },
        );
      }
      return next;
    case "send_like":
      requireParam(next, "user_id", action, "user_id");
      return next;
    case "get_msg":
    case "get_forward_msg":
      requireParam(next, "message_id", action, "message_id");
      return next;
    case "get_stranger_info":
      requireParam(next, "user_id", action, "user_id");
      return next;
    case "get_group_info":
    case "get_group_honor_info":
      requireParam(next, "group_id", action, "group_id");
      return next;
    case "get_group_member_info":
      requireParam(next, "group_id", action, "group_id");
      requireParam(next, "user_id", action, "user_id");
      return next;
    case "get_image":
    case "get_record":
      requireString(next, "file", action);
      return next;
    case "send_group_forward_msg":
      requireParam(next, "group_id", action, "group_id");
      next.messages = normalizeForwardMessages(next.messages);
      return next;
    case "set_group_card":
      requireParam(next, "group_id", action, "group_id");
      requireParam(next, "user_id", action, "user_id");
      requireString(next, "card", action, { allowEmpty: true });
      return next;
    case "set_group_name":
      requireParam(next, "group_id", action, "group_id");
      requireString(next, "group_name", action);
      return next;
    case "set_group_ban":
      requireParam(next, "group_id", action, "group_id");
      requireParam(next, "user_id", action, "user_id");
      requireNonNegativeInteger(next, "duration", action);
      return next;
    case "set_group_leave":
      requireParam(next, "group_id", action, "group_id");
      return next;
    case "set_group_whole_ban":
      requireParam(next, "group_id", action, "group_id");
      requireBoolean(next, "enable", action);
      return next;
    case "set_group_kick":
      requireParam(next, "group_id", action, "group_id");
      requireParam(next, "user_id", action, "user_id");
      return next;
    case "set_group_admin":
      requireParam(next, "group_id", action, "group_id");
      requireParam(next, "user_id", action, "user_id");
      requireBoolean(next, "enable", action);
      return next;
    case "set_group_special_title":
      requireParam(next, "group_id", action, "group_id");
      requireParam(next, "user_id", action, "user_id");
      requireString(next, "special_title", action);
      requireNonNegativeInteger(next, "duration", action);
      return next;
    case "set_friend_add_request":
      requireString(next, "flag", action);
      requireBoolean(next, "approve", action);
      return next;
    case "set_group_add_request":
      requireString(next, "flag", action);
      requireString(next, "sub_type", action);
      requireBoolean(next, "approve", action);
      return next;
    case "get_cookies":
    case "get_csrf_token":
    case "get_credentials":
      return next;
    case "set_restart":
      return next;
    case "clean_cache":
    case "get_status":
    case "get_version_info":
    case "can_send_image":
    case "can_send_record":
      return next;
    default:
      return next;
  }
}
