export const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    wsUrl: { type: "string", default: "ws://127.0.0.1:3001" },
    httpUrl: { type: "string", default: "http://127.0.0.1:3000" },
    httpBasePath: { type: "string", default: "/" },
    autoConnect: { type: "boolean", default: false },
    messageFormat: { type: "string", default: "array" },
    reconnectBaseMs: { type: "integer", default: 1000 },
    reconnectMaxMs: { type: "integer", default: 30000 },
    requestTimeoutMs: { type: "integer", default: 10000 },
    heartbeatTimeoutMs: { type: "integer", default: 30000 },
    allowedActions: { type: "array", default: [] },
    allowUnknownActions: { type: "boolean", default: false },
  },
};

export async function loadPluginConfig(ctx) {
  const pluginId = ctx.manifest.id;
  const values = await ctx.pluginConfig.get(pluginId, CONFIG_SCHEMA);
  return {
    ...values,
    accessToken: await ctx.pluginConfig.getSecret(pluginId, "accessToken"),
  };
}
