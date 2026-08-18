import { ERROR_CODES, QqActionError } from "./errors.js";

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
  "get_login_info",
  "get_stranger_info",
  "get_friend_list",
  "get_group_info",
  "get_group_list",
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

export const STANDARD_ONEBOT_ACTIONS = [
  "send_msg",
  "send_group_msg",
  "send_private_msg",
  "delete_msg",
  "get_msg",
  "get_forward_msg",
  "send_like",
  "set_group_kick",
  "set_group_ban",
  "set_group_whole_ban",
  "set_group_admin",
  "set_group_card",
  "set_group_name",
  "set_group_leave",
  "set_group_special_title",
  "set_friend_add_request",
  "set_group_add_request",
  "get_login_info",
  "get_stranger_info",
  "get_group_list",
  "get_friend_list",
  "get_group_info",
  "get_group_member_info",
  "get_group_member_list",
  "get_group_honor_info",
  "get_cookies",
  "get_csrf_token",
  "get_credentials",
  "get_record",
  "get_image",
  "can_send_image",
  "can_send_record",
  "get_status",
  "get_version_info",
  "set_restart",
  "clean_cache",
];

const WRITE_ACTIONS = new Set([
  "send_msg",
  "send_group_msg",
  "send_private_msg",
  "send_group_forward_msg",
  "delete_msg",
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
  "set_restart",
  "clean_cache",
]);

export const MANAGEMENT_ACTIONS = [
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
];

export const OWNER_ONLY_ACTIONS = [
  "set_group_admin",
  "set_group_special_title",
];

export const ADMIN_ONLY_ACTIONS = [
  "get_cookies",
  "get_csrf_token",
  "get_credentials",
  "set_restart",
  "clean_cache",
  ...OWNER_ONLY_ACTIONS,
];

export const RESTRICTED_ACTIONS = [
  "delete_msg",
  ...MANAGEMENT_ACTIONS,
  ...ADMIN_ONLY_ACTIONS,
];

const RESTRICTED_ACTION_SET = new Set(RESTRICTED_ACTIONS);

export function allowedActionsFor(config = {}) {
  return Array.isArray(config.enabledActions) && config.enabledActions.length
    ? config.enabledActions
    : BUILTIN_ACTIONS;
}

export function assertActionSupported(action, config = {}) {
  if (!action || typeof action !== "string") {
    throw new QqActionError(ERROR_CODES.INVALID_CONTEXT, "action is required");
  }
  const allowed = allowedActionsFor(config);
  if (!allowed.includes(action) && !config.allowUnknownActions) {
    throw new QqActionError(
      ERROR_CODES.UNSUPPORTED_ACTION,
      `Unsupported action: ${action}`,
      { action },
    );
  }
}

export function isWriteAction(action) {
  return WRITE_ACTIONS.has(action);
}

export function isRestrictedAction(action) {
  return RESTRICTED_ACTION_SET.has(action);
}
