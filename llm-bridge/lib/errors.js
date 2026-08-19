export const ERROR_CODES = {
  INVALID_CONTEXT: "INVALID_CONTEXT",
  INVALID_PARAMS: "INVALID_PARAMS",
  UNSUPPORTED_ACTION: "UNSUPPORTED_ACTION",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  NO_API_KEY: "NO_API_KEY",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  CONNECTION_LOST: "CONNECTION_LOST",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  TOOL_NOT_REGISTERED: "TOOL_NOT_REGISTERED",
  TOOL_PERMISSION_DENIED: "TOOL_PERMISSION_DENIED",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  DISPOSED: "DISPOSED",
  INTERNAL: "INTERNAL",
};

const STATUS_BY_CODE = {
  INVALID_CONTEXT: 400,
  INVALID_PARAMS: 400,
  UNSUPPORTED_ACTION: 400,
  PROVIDER_NOT_CONFIGURED: 400,
  NO_API_KEY: 400,
  REQUEST_TIMEOUT: 504,
  CONNECTION_LOST: 502,
  PROVIDER_ERROR: 502,
  INVALID_RESPONSE: 502,
  TOOL_NOT_REGISTERED: 400,
  TOOL_PERMISSION_DENIED: 403,
  TOOL_EXECUTION_FAILED: 502,
  DISPOSED: 503,
  INTERNAL: 500,
};

export class LLMBridgeError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = "LLMBridgeError";
    this.code = code;
    this.action = options.action || null;
    this.provider = options.provider || null;
    this.status = options.status || STATUS_BY_CODE[code] || 500;
    this.wording = options.wording || null;
    this.cause = options.cause || null;
    this.retriable = Boolean(options.retriable);
  }
}

export function toLlmBridgeError(error, action = null, provider = null) {
  if (error instanceof LLMBridgeError) return error;
  if (error && typeof error === "object" && typeof error.code === "string") {
    return new LLMBridgeError(error.code, error.message || "LLM bridge failed", {
      action,
      provider,
      wording: error.wording,
      cause: error,
    });
  }
  return new LLMBridgeError(
    ERROR_CODES.INTERNAL,
    error?.message || "LLM bridge failed",
    { action, provider, cause: error },
  );
}
