export const ERROR_CODES = {
  INVALID_CONTEXT: "INVALID_CONTEXT",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  MESSAGE_TOO_LONG: "MESSAGE_TOO_LONG",
  UNSUPPORTED_ACTION: "UNSUPPORTED_ACTION",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  ONEBOT_FAILED: "ONEBOT_FAILED",
  CONNECTION_LOST: "CONNECTION_LOST",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  DISPOSED: "DISPOSED",
  INTERNAL: "INTERNAL",
};

export class QqActionError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "QqActionError";
    this.code = code;
    this.action = options.action || null;
    this.retcode = options.retcode ?? null;
    this.wording = options.wording ?? null;
    this.cause = options.cause ?? null;
  }
}

export function toQqActionError(error, action = null) {
  if (error instanceof QqActionError) {
    return error;
  }
  if (error && typeof error === "object" && typeof error.code === "string") {
    return new QqActionError(error.code, error.message || "QQ action failed", {
      action,
      retcode: error.retcode,
      wording: error.wording,
      cause: error,
    });
  }
  return new QqActionError(
    ERROR_CODES.INTERNAL,
    error?.message || "QQ action failed",
    { action, cause: error },
  );
}
