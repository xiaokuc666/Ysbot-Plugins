export const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    enabled: { type: "boolean", default: true },
    retrievalMode: {
      type: "string",
      enum: ["hybrid", "stable", "dynamic", "full"],
      default: "hybrid",
    },
    keywordWeight: { type: "number", default: 0.4 },
    recencyWeight: { type: "number", default: 0.2 },
    salienceWeight: { type: "number", default: 0.3 },
    permissionWeight: { type: "number", default: 0.1 },
    maxContextLength: { type: "integer", default: 2000 },
    consolidationEnabled: { type: "boolean", default: true },
    minJournalEntries: { type: "integer", default: 20 },
    consolidationIntervalMs: { type: "integer", default: 3600000 },
    maxBeliefs: { type: "integer", default: 200 },
    privacyHideFromUsers: { type: "boolean", default: true },
    privacyAdminOnly: { type: "boolean", default: true },
  },
};

export async function loadPluginConfig(ctx) {
  return ctx.pluginConfig.get(ctx.manifest.id, CONFIG_SCHEMA);
}
