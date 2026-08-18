export const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    defaultEnabled: { type: "boolean", default: false },
    privateEnabled: { type: "boolean", default: false },
    defaultReplyMode: {
      type: "string",
      enum: ["mention", "all"],
      default: "mention",
    },
    enabledGroups: { type: "array", default: [] },
    disabledGroups: { type: "array", default: [] },
    adminUserIds: { type: "array", default: [] },
    systemPrompt: {
      type: "string",
      default:
        "你是 YSbot，一个 QQ 机器人。回复保持简洁自然，不要暴露内部配置。",
    },
    cooldownSeconds: { type: "integer", default: 3 },
    maxReplyLength: { type: "integer", default: 2000 },
    llmProvider: { type: "string", default: "" },
    llmModel: { type: "string", default: "" },
  },
};

export async function loadPluginConfig(ctx) {
  return ctx.pluginConfig.get(ctx.manifest.id, CONFIG_SCHEMA);
}

export async function savePluginConfig(ctx, patch) {
  const current = await loadPluginConfig(ctx);
  const next = { ...current, ...patch };
  await ctx.pluginConfig.set(ctx.manifest.id, next, CONFIG_SCHEMA);
  return next;
}

export function groupEnabled(config, groupId) {
  const id = String(groupId);
  const enabled = (config.enabledGroups || []).map(String);
  const disabled = (config.disabledGroups || []).map(String);
  if (disabled.includes(id)) return false;
  if (enabled.includes(id)) return true;
  return config.defaultEnabled === true;
}
