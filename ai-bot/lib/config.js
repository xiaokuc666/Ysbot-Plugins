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
    curiosityEnabled: { type: "boolean", default: false },
    curiosityMemoryEnabled: { type: "boolean", default: true },
    curiosityDirectCooldownMs: { type: "integer", default: 15000 },
    curiosityGroupActiveCooldownMs: { type: "integer", default: 60000 },
    curiosityPeriodicProbeEnabled: { type: "boolean", default: false },
    curiosityPeriodicProbeIntervalMs: { type: "integer", default: 300000 },
    curiosityPeriodicProbeProbability: { type: "number", default: 0.1 },
    curiosityRandomReplyProbability: { type: "number", default: 0.05 },
    memoryRecallLimit: { type: "integer", default: 10 },
    memoryMaxInjection: { type: "integer", default: 2000 },
    historyMaxEntries: { type: "integer", default: 20 },
    historyMaxAgeMs: { type: "integer", default: 3600000 },
    timeZone: { type: "string", default: "Asia/Shanghai" },
    directAttentionWindowMs: { type: "integer", default: 30000 },
    directAttentionFollowCooldownMs: { type: "integer", default: 5000 },
    directAttentionFollowProbability: { type: "number", default: 0.5 },
    llmTools: { type: "array", default: [] },
    maxToolRounds: { type: "integer", default: 3 },
    replyWithAt: { type: "boolean", default: true },
    replyWithQuote: { type: "boolean", default: true },
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
