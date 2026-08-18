import { OneBotActionError } from "./errors.js";

export const BUILTIN_ACTIONS = [
  "send_msg",
  "send_group_msg",
  "send_private_msg",
  "send_group_forward_msg",
  "delete_msg",
  "get_msg",
  "get_forward_msg",
  "send_like",
  "set_group_card",
  "set_group_name",
  "set_group_ban",
  "set_group_whole_ban",
  "set_group_kick",
  "set_group_admin",
  "set_group_leave",
  "set_group_special_title",
  "set_friend_add_request",
  "set_group_add_request",
  "delete_friend",
  "get_group_system_msg",
  "get_doubt_friends_add_request",
  "set_doubt_friends_add_request",
  "get_login_info",
  "get_stranger_info",
  "get_group_list",
  "get_friend_list",
  "get_group_info",
  "get_group_member_info",
  "get_group_member_list",
  "get_group_honor_info",
  "get_image",
  "get_record",
  "can_send_image",
  "can_send_record",
  "get_status",
  "get_version_info",
  "get_cookies",
  "get_csrf_token",
  "get_credentials",
  "set_restart",
  "clean_cache",
];

const SENSITIVE_ACTIONS = new Set([
  "delete_msg",
  "set_group_card",
  "set_group_name",
  "set_group_ban",
  "set_group_whole_ban",
  "set_group_kick",
  "set_group_admin",
  "set_group_leave",
  "set_group_special_title",
  "set_friend_add_request",
  "set_group_add_request",
  "delete_friend",
  "set_doubt_friends_add_request",
  "get_cookies",
  "get_csrf_token",
  "get_credentials",
  "set_restart",
  "clean_cache",
]);

function requireActorScene(action, context) {
  if (!context?.actor?.id || !context?.scene?.id) {
    throw new OneBotActionError(
      "INVALID_CONTEXT",
      `${action} requires actor and scene`,
    );
  }
}

export function allowedActionsFor(config) {
  return config.allowedActions?.length
    ? config.allowedActions
    : BUILTIN_ACTIONS;
}

export function assertActionAllowed(action, context = {}, config = {}) {
  const allowed = allowedActionsFor(config);
  if (!allowed.includes(action) && !config.allowUnknownActions) {
    throw new OneBotActionError(
      "UNSUPPORTED_ACTION",
      `Unsupported action: ${action}`,
    );
  }
  if (
    action === "send_msg" ||
    action === "send_group_msg" ||
    action === "send_private_msg" ||
    action === "send_group_forward_msg"
  ) {
    requireActorScene(action, context);
  }
  if (SENSITIVE_ACTIONS.has(action)) {
    if (!context?.actor?.id || !context?.scene?.id) {
      throw new OneBotActionError(
        "INVALID_CONTEXT",
        `${action} requires actor and scene`,
      );
    }
    if (!context.actor.admin && !context.approved) {
      throw new OneBotActionError(
        "PERMISSION_DENIED",
        `${action} requires admin or explicit approval`,
      );
    }
  }
}
