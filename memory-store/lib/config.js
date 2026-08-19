export const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    enabled: { type: "boolean", default: true },
    maxEntriesPerGroup: { type: "integer", default: 500 },
    maxEntriesPerUser: { type: "integer", default: 200 },
    recallDefaultLimit: { type: "integer", default: 20 },
    summaryAfterEntries: { type: "integer", default: 50 },
    maxMemoryLength: { type: "integer", default: 2000 },
  },
};

export async function loadPluginConfig(ctx) {
  return ctx.pluginConfig.get(ctx.manifest.id, CONFIG_SCHEMA);
}
