import fs from "node:fs/promises";
import path from "node:path";

function generateId() {
  return `mem-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function extractText(event = {}) {
  if (typeof event.text === "string" && event.text.trim()) {
    return event.text.trim();
  }
  if (Array.isArray(event.message)) {
    const text = event.message
      .filter((segment) => segment?.type === "text")
      .map((segment) => segment.data?.text || "")
      .join("");
    if (text.trim()) return text.trim();
  }
  return String(event.raw_message || "").trim();
}

function matches(entry, { groupId, userId, query, type } = {}) {
  if (groupId && entry.groupId !== String(groupId)) return false;
  if (userId && entry.userId !== String(userId)) return false;
  if (type && entry.type !== type) return false;
  if (query) {
    const q = String(query).toLowerCase();
    if (!String(entry.content || "").toLowerCase().includes(q)) return false;
  }
  return true;
}

export class MemoryRepository {
  constructor({ dataDir, config, logger }) {
    this.file = path.join(dataDir, "memory.jsonl");
    this.config = config;
    this.logger = logger;
    this.entries = [];
    this.writeChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.entries = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async rewrite() {
    this.writeChain = this.writeChain
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await fs.writeFile(
          tmp,
          this.entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
          "utf8",
        );
        await fs.rename(tmp, this.file);
      })
      .catch(() => {});
    await this.writeChain;
  }

  async append(entry) {
    this.entries.push(entry);
    this.prune();
    await this.rewrite();
    return entry;
  }

  prune() {
    const maxGroup = Number(this.config.maxEntriesPerGroup) || 500;
    const maxUser = Number(this.config.maxEntriesPerUser) || 200;
    const groupMap = new Map();
    const userMap = new Map();
    for (const entry of this.entries) {
      if (entry.groupId) {
        const list = groupMap.get(entry.groupId) || [];
        list.push(entry);
        groupMap.set(entry.groupId, list);
      }
      if (entry.userId) {
        const list = userMap.get(entry.userId) || [];
        list.push(entry);
        userMap.set(entry.userId, list);
      }
    }
    const removeOldest = (list, max) => {
      if (list.length <= max) return new Set();
      const sorted = [...list].sort((a, b) =>
        String(a.ts).localeCompare(String(b.ts)),
      );
      return new Set(sorted.slice(0, sorted.length - max).map((entry) => entry.id));
    };
    const removeIds = new Set();
    for (const list of groupMap.values()) {
      for (const id of removeOldest(list, maxGroup)) removeIds.add(id);
    }
    for (const list of userMap.values()) {
      for (const id of removeOldest(list, maxUser)) removeIds.add(id);
    }
    if (removeIds.size) {
      this.entries = this.entries.filter((entry) => !removeIds.has(entry.id));
    }
  }

  async observe({ event, traceId }) {
    const text = extractText(event);
    if (!text) return null;
    const groupId = event.group_id
      ? String(event.group_id)
      : event.scene?.type === "group"
        ? String(event.scene.id)
        : null;
    const userId = event.user_id
      ? String(event.user_id)
      : event.sender?.user_id
        ? String(event.sender.user_id)
        : event.scene?.type === "private"
          ? String(event.scene.id)
          : null;
    const entry = {
      id: generateId(),
      ts: new Date().toISOString(),
      groupId,
      userId,
      type: "fact",
      content: text.slice(0, Number(this.config.maxMemoryLength) || 2000),
      source: "message",
      traceId: traceId || null,
    };
    await this.append(entry);
    if (groupId) await this.maybeSummarize(groupId, traceId);
    return entry;
  }

  async recall({ groupId, userId, query, limit } = {}) {
    const max = Number(limit) || Number(this.config.recallDefaultLimit) || 20;
    return this.entries
      .filter((entry) => matches(entry, { groupId, userId, query }))
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
      .slice(0, Math.max(1, Math.min(200, max)));
  }

  async note({ groupId, userId, content, actor, type = "note", traceId }) {
    if (!content || !String(content).trim()) {
      throw new Error("content is required");
    }
    return this.append({
      id: generateId(),
      ts: new Date().toISOString(),
      groupId: groupId ? String(groupId) : null,
      userId: userId ? String(userId) : null,
      type: type === "impression" ? "impression" : "note",
      content: String(content).slice(0, Number(this.config.maxMemoryLength) || 2000),
      source: "note",
      actorId: actor?.id || null,
      traceId: traceId || null,
    });
  }

  async list({ groupId, userId, query, type, limit, offset = 0 } = {}) {
    const filtered = this.entries
      .filter((entry) => matches(entry, { groupId, userId, query, type }))
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    const max = Number(limit) || Number(this.config.recallDefaultLimit) || 20;
    const start = Number(offset) || 0;
    return {
      entries: filtered.slice(start, start + Math.max(1, Math.min(200, max))),
      total: filtered.length,
    };
  }

  async forget({ id, groupId, userId }) {
    if (id) {
      const before = this.entries.length;
      this.entries = this.entries.filter((entry) => entry.id !== id);
      await this.rewrite();
      return { removed: before - this.entries.length };
    }
    if (!groupId && !userId) throw new Error("id or groupId/userId is required");
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (entry) => !matches(entry, { groupId, userId }),
    );
    await this.rewrite();
    return { removed: before - this.entries.length };
  }

  async clear({ groupId, userId }) {
    if (!groupId && !userId) throw new Error("groupId or userId is required");
    return this.forget({ groupId, userId });
  }

  async summarize({ groupId, userId, traceId } = {}) {
    const recent = this.entries
      .filter((entry) => matches(entry, { groupId, userId }))
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
      .slice(0, 20);
    if (!recent.length) return null;
    const content = `最近 ${recent.length} 条记忆摘要：\n${recent
      .map((entry) => `${entry.ts} [${entry.type}] ${entry.content}`)
      .join("\n")}`;
    return this.append({
      id: generateId(),
      ts: new Date().toISOString(),
      groupId: groupId ? String(groupId) : null,
      userId: userId ? String(userId) : null,
      type: "summary",
      content,
      source: "summary",
      traceId: traceId || null,
    });
  }

  async maybeSummarize(groupId, traceId) {
    const threshold = Number(this.config.summaryAfterEntries) || 50;
    const groupEntries = this.entries.filter((entry) => entry.groupId === groupId);
    const lastSummary = groupEntries
      .filter((entry) => entry.type === "summary")
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0]?.ts;
    const nonSummaryCount = groupEntries.filter(
      (entry) => entry.type !== "summary" && (!lastSummary || entry.ts > lastSummary),
    ).length;
    if (nonSummaryCount >= threshold) {
      await this.summarize({ groupId, traceId });
    }
  }

  stats() {
    const groups = new Set(this.entries.map((entry) => entry.groupId).filter(Boolean));
    const users = new Set(this.entries.map((entry) => entry.userId).filter(Boolean));
    return {
      total: this.entries.length,
      groups: groups.size,
      users: users.size,
    };
  }
}
