import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  listPluginDirs,
  listPlugins,
  loadPluginManifest,
} from "./manifests.js";
import { distDir, ensureDir, pathExists } from "./workspace.js";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD_HEADER = 0x06054b50;

const EXCLUDED_PARTS = new Set([
  ".cache",
  ".git",
  "data",
  "dist",
  "node_modules",
  "test",
  "tests",
]);

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeArchiveName(relativePath) {
  const normalized = path
    .normalize(relativePath)
    .replace(/^[/\\]+/, "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/");
  if (!normalized || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  if (normalized.split("/").includes("..")) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  return normalized;
}

function createPlgBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuffer = Buffer.from(name, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt16LE(0, 14);
    local.writeUInt32LE(checksum, 16);
    local.writeUInt32LE(data.length, 20);
    local.writeUInt32LE(data.length, 24);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(Buffer.concat([local, nameBuffer, data]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, nameBuffer]));

    offset += local.length + nameBuffer.length + data.length;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_HEADER, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, central, eocd]);
}

async function walkFiles(dir, root, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_PARTS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full);
    if (entry.isDirectory()) {
      await walkFiles(full, root, out);
    } else if (entry.isFile()) {
      const name = safeArchiveName(relative);
      if (
        name.endsWith(".test.js") ||
        name.endsWith(".spec.js") ||
        name.startsWith(".")
      ) {
        continue;
      }
      out.push({
        name,
        data: await fs.readFile(full),
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function selectFiles(entries, manifest) {
  const files = manifest.files;
  if (!Array.isArray(files)) return entries;
  const allowed = new Set(files.map((file) => safeArchiveName(file)));
  return entries.filter((entry) => {
    return entry.name === "plugin.json" || entry.name === "index.js" || allowed.has(entry.name);
  });
}

export async function packPlugin(
  pluginDir,
  outDir = path.join(pluginDir, "dist"),
) {
  const manifest = await loadPluginManifest(pluginDir);
  const files = selectFiles(await walkFiles(pluginDir, pluginDir), manifest);
  const buffer = createPlgBuffer(files);
  const fileName = `${manifest.id}-${manifest.version || "0.0.0"}.plg`;
  const outFile = path.join(outDir, fileName);
  await ensureDir(outDir);
  await fs.writeFile(outFile, buffer);

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  await fs.writeFile(`${outFile}.sha256`, `${hash}  ${fileName}\n`, "utf8");
  return {
    id: manifest.id,
    version: manifest.version,
    file: outFile,
    entries: files.length,
    bytes: buffer.length,
    sha256: hash,
  };
}

export async function packPlugins(ids = null, outDir = null) {
  const dirs = await listPluginDirs();
  const selected = ids
    ? dirs.filter((dir) => ids.includes(path.basename(dir)))
    : dirs;
  const results = [];
  for (const dir of selected) {
    results.push(await packPlugin(dir, outDir || path.join(dir, "dist")));
  }
  return results;
}

export async function writeCatalog(outPath = path.join(distDir, "catalog.json"), root = null) {
  const plugins = await listPlugins(root);
  await ensureDir(path.dirname(outPath));
  const catalog = {
    generatedAt: new Date().toISOString(),
    pluginCount: plugins.length,
    plugins,
  };
  await fs.writeFile(outPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return outPath;
}

export async function plgPathExists(target) {
  return pathExists(target);
}
