import zlib from "node:zlib";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD_HEADER = 0x06054b50;
const MAX_PLG_SIZE = 10 * 1024 * 1024;
const MAX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024;

export const PLUGIN_TYPES = [
  "motivation",
  "capability",
  "protocol",
  "action",
  "feedback",
  "policy",
  "system",
];

export function httpError(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

function findEocd(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_HEADER) return offset;
  }
  throw httpError(400, "Invalid .plg: missing ZIP end record");
}

function parseCentralEntries(buffer, eocdOffset) {
  const count = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length) {
      throw httpError(400, "Invalid .plg: central directory is truncated");
    }
    if (buffer.readUInt32LE(offset) !== CENTRAL_HEADER) {
      throw httpError(400, "Invalid .plg: broken central directory");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (offset + 46 + nameLength + extraLength + commentLength > buffer.length) {
      throw httpError(400, "Invalid .plg: central entry exceeds file size");
    }
    const name = buffer.toString(
      "utf8",
      offset + 46,
      offset + 46 + nameLength,
    );
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntryData(buffer, entry) {
  if (entry.uncompressedSize > MAX_UNCOMPRESSED_SIZE) {
    throw httpError(400, "Uncompressed .plg entry exceeds size limit");
  }
  if (entry.localOffset + 30 > buffer.length) {
    throw httpError(400, "Invalid .plg: local header is truncated");
  }
  if (buffer.readUInt32LE(entry.localOffset) !== LOCAL_HEADER) {
    throw httpError(400, "Invalid .plg: broken local header");
  }
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  if (dataStart + entry.compressedSize > buffer.length) {
    throw httpError(400, "Invalid .plg: entry data exceeds file size");
  }
  const compressed = buffer.subarray(
    dataStart,
    dataStart + entry.compressedSize,
  );
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw httpError(400, `Unsupported .plg compression method: ${entry.method}`);
}

export function readPlgEntries(buffer) {
  const eocdOffset = findEocd(buffer);
  return parseCentralEntries(buffer, eocdOffset).map((entry) => ({
    ...entry,
    data: readEntryData(buffer, entry),
  }));
}

export function readPlgFile(buffer, name) {
  const entry = readPlgEntries(buffer).find((item) => item.name === name);
  return entry ? entry.data : null;
}

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest.id !== "string" || !manifest.id) {
    errors.push("id must be a non-empty string");
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
    errors.push("id must match [a-z0-9][a-z0-9-]*");
  }
  if (!PLUGIN_TYPES.includes(manifest?.type)) {
    errors.push(`type must be one of ${PLUGIN_TYPES.join("/")}`);
  }
  if (typeof manifest?.version !== "string" || !manifest.version) {
    errors.push("version must be a non-empty string");
  }
  if (manifest?.dependencies !== undefined && !Array.isArray(manifest.dependencies)) {
    errors.push("dependencies must be an array");
  }
  if (errors.length) {
    throw httpError(400, `Invalid plugin manifest: ${errors.join("; ")}`);
  }
}

export function parsePlgPayload(fileName, plgBase64) {
  if (typeof fileName !== "string" || !fileName.toLowerCase().endsWith(".plg")) {
    throw httpError(400, "fileName must end with .plg");
  }
  if (typeof plgBase64 !== "string" || !plgBase64.trim()) {
    throw httpError(400, "plgBase64 is required");
  }
  const buffer = Buffer.from(plgBase64, "base64");
  if (!buffer.length) throw httpError(400, "Empty .plg file");
  if (buffer.length > MAX_PLG_SIZE) {
    throw httpError(400, `.plg file exceeds ${MAX_PLG_SIZE} bytes`);
  }
  const manifestBuffer = readPlgFile(buffer, "plugin.json");
  if (!manifestBuffer) throw httpError(400, "Missing plugin.json in .plg");
  let manifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    throw httpError(400, "plugin.json is not valid JSON");
  }
  validateManifest(manifest);
  if (!readPlgFile(buffer, "index.js")) {
    throw httpError(400, "Missing index.js in .plg");
  }
  return { buffer, manifest, fileName };
}
