import { RESTRICTED_ACTIONS } from "./actions.js";

export const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    enabledActions: { type: "array", default: [] },
    allowUnknownActions: { type: "boolean", default: false },
    managementOnlyActions: { type: "array", default: [...RESTRICTED_ACTIONS] },
    requireApprovalActions: { type: "array", default: [...RESTRICTED_ACTIONS] },
    maxMessageLength: { type: "integer", default: 5000 },
  },
};

export async function loadPluginConfig(ctx) {
  return ctx.pluginConfig.get(ctx.manifest.id, CONFIG_SCHEMA);
}
