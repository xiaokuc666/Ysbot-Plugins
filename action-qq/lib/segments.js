import { ERROR_CODES, QqActionError } from "./errors.js";

export function normalizeMessage(message) {
  if (typeof message === "string") {
    return [{ type: "text", data: { text: message } }];
  }
  if (!Array.isArray(message)) {
    throw new QqActionError(
      ERROR_CODES.INVALID_MESSAGE,
      "message must be a string or a OneBot message segment array",
    );
  }
  if (message.length === 0) {
    throw new QqActionError(
      ERROR_CODES.INVALID_MESSAGE,
      "message must not be empty",
    );
  }
  return message.map((segment, index) => normalizeSegment(segment, index));
}

function normalizeSegment(segment, index) {
  if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
    throw invalidSegment(index, "segment must be an object");
  }
  if (typeof segment.type !== "string" || !segment.type.trim()) {
    throw invalidSegment(index, "segment.type is required");
  }
  const data =
    segment.data && typeof segment.data === "object" && !Array.isArray(segment.data)
      ? segment.data
      : {};

  if (segment.type === "text" && typeof data.text !== "string") {
    throw invalidSegment(index, "text segment requires data.text");
  }
  if (segment.type === "at" && (data.qq === undefined || data.qq === null || data.qq === "")) {
    throw invalidSegment(index, "at segment requires data.qq");
  }
  if (segment.type === "face" && data.id === undefined) {
    throw invalidSegment(index, "face segment requires data.id");
  }
  if (segment.type === "reply" && data.id === undefined) {
    throw invalidSegment(index, "reply segment requires data.id");
  }
  if (segment.type === "image" && (data.file === undefined || data.file === "")) {
    throw invalidSegment(index, "image segment requires data.file");
  }
  if (
    (segment.type === "record" || segment.type === "video") &&
    (data.file === undefined || data.file === "")
  ) {
    throw invalidSegment(index, `${segment.type} segment requires data.file`);
  }
  if (segment.type === "share") {
    if (!data.url || !data.title) {
      throw invalidSegment(index, "share segment requires data.url and data.title");
    }
  }
  if (segment.type === "contact") {
    if (!data.type || !data.id) {
      throw invalidSegment(index, "contact segment requires data.type and data.id");
    }
  }
  if (segment.type === "location") {
    if (data.lat === undefined || data.lon === undefined) {
      throw invalidSegment(index, "location segment requires data.lat and data.lon");
    }
  }
  if (segment.type === "music") {
    if (data.type !== "custom" && data.id === undefined) {
      throw invalidSegment(index, "music segment requires data.id");
    }
  }
  if (segment.type === "forward" && data.id === undefined) {
    throw invalidSegment(index, "forward segment requires data.id");
  }
  if (segment.type === "json" && data.data === undefined) {
    throw invalidSegment(index, "json segment requires data.data");
  }
  if (segment.type === "xml" && data.data === undefined) {
    throw invalidSegment(index, "xml segment requires data.data");
  }
  if (segment.type === "node") {
    throw invalidSegment(index, "node segment is only valid inside forward nodes");
  }
  if (segment.type === "anonymous") {
    throw invalidSegment(index, "anonymous segment is not supported");
  }

  return { type: segment.type, data: { ...data } };
}

function invalidSegment(index, message) {
  return new QqActionError(
    ERROR_CODES.INVALID_MESSAGE,
    `message segment ${index} invalid: ${message}`,
  );
}

export function assertMessageLength(message, maxLength = 5000) {
  const normalized = Array.isArray(message) ? message : normalizeMessage(message);
  const textLength = normalized.reduce((total, segment) => {
    if (segment.type === "text" && typeof segment.data?.text === "string") {
      return total + segment.data.text.length;
    }
    return total;
  }, 0);
  const limit = Math.max(1, Number(maxLength) || 5000);
  if (textLength > limit) {
    throw new QqActionError(
      ERROR_CODES.MESSAGE_TOO_LONG,
      `message text length ${textLength} exceeds limit ${limit}`,
    );
  }
}
