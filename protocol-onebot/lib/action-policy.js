import { OneBotActionError } from "./errors.js";

export const BUILTIN_ACTIONS = [
  "send_group_msg",
  "send_private_msg",
  "delete_msg",
  "get_login_info",
  "get_group_list",
  "get_friend_list",
  "get_group_member_info",
  "get_group_member_list",
];

const SENSITIVE_ACTIONS = new Set(["delete_msg"]);

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
  if (action === "send_group_msg" || action === "send_private_msg") {
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
