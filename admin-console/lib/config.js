import fs from "node:fs/promises";
import { httpError } from "./plg.js";

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

export function getSecretFields(metadata) {
  const schemaFields = Object.entries(metadata?.config?.schema?.properties || {})
    .filter(([, prop]) => prop?.secret === true)
    .map(([key]) => key);
  const declared = metadata?.config?.secrets || [];
  return [...new Set([...schemaFields, ...declared])];
}

function schemaWithoutSecretFields(metadata) {
  const schema = metadata?.config?.schema || {};
  const secretFields = new Set(getSecretFields(metadata));
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties || {}).filter(
        ([key]) => !secretFields.has(key),
      ),
    ),
  };
}

async function assertConfigReadable(ctx, pluginId) {
  const store = ctx.pluginConfig;
  if (!store || typeof store.file !== "function") return;
  try {
    const raw = await fs.readFile(store.file(pluginId), "utf8");
    JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw httpError(500, `Config file corrupted for ${pluginId}: ${error.message}`);
  }
}

export async function getConfigSnapshot(ctx, pluginId, metadata) {
  const store = ctx.pluginConfig;
  if (!store) throw httpError(500, "ctx.pluginConfig is not available");
  await assertConfigReadable(ctx, pluginId);
  const values = await store.get(pluginId, schemaWithoutSecretFields(metadata));
  const secretState = {};
  for (const key of getSecretFields(metadata)) {
    secretState[key] = await store.hasSecret(pluginId, key);
  }
  return { values, secretState };
}

export async function validateConfig(ctx, pluginId, metadata, values = {}) {
  const store = ctx.pluginConfig;
  if (!store) throw httpError(500, "ctx.pluginConfig is not available");
  try {
    store.validate(pluginId, values, schemaWithoutSecretFields(metadata));
    return { ok: true };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

export async function saveConfig(ctx, pluginId, metadata, values = {}, clearSecret = []) {
  const store = ctx.pluginConfig;
  if (!store) throw httpError(500, "ctx.pluginConfig is not available");
  await assertConfigReadable(ctx, pluginId);
  const secretFields = new Set(getSecretFields(metadata));
  const normal = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (secretFields.has(key)) {
      // Secret writes happen only after normal config validation succeeds.
    } else {
      normal[key] = value;
    }
  }
  const schema = schemaWithoutSecretFields(metadata);
  try {
    store.validate(pluginId, normal, schema);
  } catch (error) {
    throw httpError(400, error.message);
  }
  const previous = await store.get(pluginId, schema);
  const affectedSecrets = new Set();
  for (const [key, value] of Object.entries(values || {})) {
    if (secretFields.has(key) && hasValue(value)) {
      affectedSecrets.add(key);
    }
  }
  for (const key of clearSecret || []) {
    if (secretFields.has(key)) affectedSecrets.add(key);
  }
  const previousSecrets = {};
  for (const key of affectedSecrets) {
    previousSecrets[key] = await store.getSecret(pluginId, key);
  }
  try {
    await store.set(pluginId, normal, schema);
    for (const [key, value] of Object.entries(values || {})) {
      if (secretFields.has(key) && hasValue(value)) {
        await store.setSecret(pluginId, key, value);
      }
    }
    for (const key of clearSecret || []) {
      if (secretFields.has(key)) await store.clearSecret(pluginId, key);
    }
  } catch (error) {
    try {
      await store.set(pluginId, previous, schema);
      for (const key of affectedSecrets) {
        const oldValue = previousSecrets[key];
        if (!hasValue(oldValue)) await store.clearSecret(pluginId, key);
        else await store.setSecret(pluginId, key, oldValue);
      }
    } catch (restoreError) {
      error.restoreError = restoreError.message;
    }
    throw error;
  }
  return getConfigSnapshot(ctx, pluginId, metadata);
}

export async function resetConfig(ctx, pluginId, metadata) {
  const store = ctx.pluginConfig;
  if (!store) throw httpError(500, "ctx.pluginConfig is not available");
  await store.reset(pluginId, schemaWithoutSecretFields(metadata));
  for (const key of getSecretFields(metadata)) {
    await store.clearSecret(pluginId, key);
  }
  return getConfigSnapshot(ctx, pluginId, metadata);
}
