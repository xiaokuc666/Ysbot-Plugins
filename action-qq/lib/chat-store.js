import fs from "node:fs/promises";
import path from "node:path";

function toText(segment) {
  if (segment.type === "text") return String(segment.data?.text ?? "");
  if (segment.type === "at") return `@${segment.data?.qq ?? segment.data?.id ?? ""}`;
  if (segment.type === "image") return `[图片 ${segment.data?.file ?? ""}]`.trim();
  if (segment.type === "record") return `[语音 ${segment.data?.file ?? ""}]`.trim();
  if (segment.type === "video") return `[视频 ${segment.data?.file ?? ""}]`.trim();
  if (segment.type === "file") return `[文件 ${segment.data?.name ?? segment.data?.file ?? ""}]`.trim();
  if (segment.type === "face") return `[表情 ${segment.data?.id ?? ""}]`.trim();
  if (segment.type === "reply") return `[回复 ${segment.data?.id ?? ""}]`.trim();
  if (segment.type === "forward") return "[转发消息]";
  if (segment.type === "json") return "[JSON卡片]";
  const dataText = segment.data ? JSON.stringify(segment.data) : "";
  return `[${segment.type}${dataText ? ` ${dataText}` : ""}]`;
}

export function messageToText(event) {
  if (Array.isArray(event.message)) {
    const text = event.message.map(toText).join(" ").trim();
    if (text) return text;
  }
  return String(event.raw_message ?? event.text ?? "").trim();
}

function cloneSegments(message) {
  if (!Array.isArray(message)) return null;
  return message.map((segment) => ({
    type: segment?.type || "unknown",
    data: segment?.data && typeof segment.data === "object"
      ? { ...segment.data }
      : {},
  }));
}

export async function createChatStore({
  dataDir,
  maxEntries = 2000,
  logger = null,
}) {
  const file = path.join(dataDir, "chat.jsonl");
  const removedFile = path.join(dataDir, "removed-scenes.json");
  let records = [];
  let removedScenes = new Set();
  const pendingCaptures = new Map();
  let writeChain = Promise.resolve();

  async function load() {
    try {
      const raw = await fs.readFile(file, "utf8");
      records = raw
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .slice(-maxEntries);
    } catch {
      records = [];
    }
  }

  async function persist() {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(
      tmp,
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
    await fs.rename(tmp, file);
  }

  async function loadRemovedScenes() {
    try {
      const parsed = JSON.parse(await fs.readFile(removedFile, "utf8"));
      removedScenes = new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      removedScenes = new Set();
    }
  }

  async function saveRemovedScenes() {
    await fs.mkdir(path.dirname(removedFile), { recursive: true });
    const tmp = `${removedFile}.tmp`;
    await fs.writeFile(
      tmp,
      `${JSON.stringify([...removedScenes])}\n`,
      "utf8",
    );
    await fs.rename(tmp, removedFile);
  }

  async function append(record) {
    records.push(record);
    if (records.length > maxEntries) {
      records = records.slice(-Math.floor(maxEntries * 0.8));
      await persist();
      return;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
  }

  async function capture(event) {
    const isGroup = event.message_type === "group";
    const sceneType = isGroup ? "group" : "private";
    const sceneId = isGroup ? String(event.group_id) : String(event.user_id);
    const messageId = String(
      event.raw?.message_id ?? event.id ?? `${Date.now()}-${Math.random()}`,
    );
    const sceneKey = `${sceneType}:${sceneId}`;
    const dedupeKey = [
      sceneType,
      sceneId,
      messageId,
      String(event.user_id ?? ""),
      String(event.timestamp ?? ""),
      Array.isArray(event.message) ? event.message.length : 0,
    ].join(":");
    const existing = records.find(
      (record) =>
        record.dedupeKey === dedupeKey ||
        (record.sceneType === sceneType &&
          record.sceneId === sceneId &&
          record.messageId === messageId),
    );
    if (existing) return existing;
    if (pendingCaptures.has(dedupeKey)) {
      return pendingCaptures.get(dedupeKey);
    }
    const pending = (async () => {
      if (removedScenes.delete(sceneKey)) {
        await saveRemovedScenes();
      }
      const record = {
        id: String(event.id || messageId),
        messageId,
        dedupeKey,
        direction: "in",
        messageType: String(event.message_type || "unknown"),
        sceneType,
        sceneId,
        senderId: String(event.user_id || ""),
        senderName: String(event.sender?.nickname || event.user_id || "未知"),
        sender: event.sender
          ? {
              id: String(event.sender.user_id ?? event.sender.id ?? event.user_id ?? ""),
              nickname: String(event.sender.nickname || ""),
              card: String(event.sender.card || ""),
              role: String(event.sender.role || ""),
            }
          : null,
        text: messageToText(event),
        segments: cloneSegments(event.message),
        raw: event.raw ?? event,
        ts: new Date(
          event.timestamp ? Number(event.timestamp) * 1000 : Date.now(),
        ).toISOString(),
        groupName: event.raw?.group_name ? String(event.raw.group_name) : null,
        recalled: false,
      };
      await append(record);
      return record;
    })();
    pendingCaptures.set(dedupeKey, pending);
    try {
      return await pending;
    } finally {
      pendingCaptures.delete(dedupeKey);
    }
  }

  async function recordOutgoing({
    messageId,
    sceneType,
    sceneId,
    segments,
    text,
  }) {
    const normalizedSegments = Array.isArray(segments)
      ? cloneSegments(segments)
      : text
        ? [{ type: "text", data: { text: String(text) } }]
        : null;
    const record = {
      id: `out-${messageId}-${Date.now()}`,
      messageId: String(messageId),
      direction: "out",
      messageType: sceneType === "group" ? "group" : "private",
      sceneType,
      sceneId: String(sceneId),
      senderId: "management",
      senderName: "我",
      sender: {
        id: "management",
        nickname: "我",
        card: "",
        role: "admin",
      },
      text: String(text || ""),
      segments: normalizedSegments,
      raw: null,
      ts: new Date().toISOString(),
      groupName: null,
      recalled: false,
    };
    await append(record);
    return record;
  }

  function listScenes() {
    const scenes = new Map();
    for (const record of records) {
      const key = `${record.sceneType}:${record.sceneId}`;
      if (removedScenes.has(key)) continue;
      const previous = scenes.get(key);
      const title =
        record.sceneType === "group"
          ? record.groupName || `群聊 ${record.sceneId}`
          : record.senderName || `好友 ${record.sceneId}`;
      if (!previous || record.ts > previous.lastTs) {
        scenes.set(key, {
          type: record.sceneType,
          id: record.sceneId,
          title,
          lastTs: record.ts,
          lastText: record.text,
        });
      }
    }
    return [...scenes.values()].sort((a, b) =>
      String(b.lastTs).localeCompare(String(a.lastTs)),
    );
  }

  function listMessages(sceneType, sceneId, limit = 200) {
    if (removedScenes.has(`${sceneType}:${sceneId}`)) return [];
    return records
      .filter(
        (record) =>
          record.sceneType === sceneType && String(record.sceneId) === String(sceneId),
      )
      .slice(-Math.max(1, Math.min(1000, Number(limit) || 200)));
  }

  function findByMessageId(messageId) {
    const target = String(messageId);
    return [...records].reverse().find((record) => record.messageId === target) || null;
  }

  async function markRecalled(messageId) {
    const target = String(messageId);
    let changed = false;
    for (const record of records) {
      if (record.messageId === target && !record.recalled) {
        record.recalled = true;
        changed = true;
      }
    }
    if (changed) await persist();
    return changed;
  }

  async function clearScene(sceneType, sceneId) {
    const before = records.length;
    records = records.filter(
      (record) =>
        !(
          record.sceneType === sceneType &&
          String(record.sceneId) === String(sceneId)
        ),
    );
    removedScenes.add(`${sceneType}:${sceneId}`);
    if (records.length !== before) await persist();
    await saveRemovedScenes();
    return true;
  }

  function isSceneRemoved(sceneType, sceneId) {
    return removedScenes.has(`${sceneType}:${sceneId}`);
  }

  function flush() {
    return writeChain.catch(() => {});
  }

  await load();
  await loadRemovedScenes();
  return {
    file,
    capture,
    recordOutgoing,
    listScenes,
    listMessages,
    findByMessageId,
    markRecalled,
    clearScene,
    isSceneRemoved,
    flush,
  };
}
