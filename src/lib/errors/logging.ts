import "server-only";

/**
 * Structured server logging with request correlation.
 *
 * One correlation ID per action/request is propagated as `x-correlation-id`
 * and attached to every emitted record. Sensitive keys are redacted before
 * serialization; passwords, tokens, cookies, and raw payloads never reach the
 * log stream.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  operation: string;
  correlationId?: string;
  userId?: string;
  errorCode?: string;
}

export const CORRELATION_ID_HEADER = "x-correlation-id";

const SENSITIVE_KEY_FRAGMENTS = [
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "credential",
] as const;

const MAX_LOG_DEPTH = 6;

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, "");

  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

export function redactForLogging(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      // Never emit anything that looks like a Supabase secret key material.
      return value.replace(
        /\b(sb_secret_|sb_publishable_)[A-Za-z0-9_-]+/g,
        "$1[redacted]",
      );
    }

    return value;
  }

  if (depth >= MAX_LOG_DEPTH) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactForLogging(item, depth + 1));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  const output: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveKey(key)
      ? "[redacted]"
      : redactForLogging(item, depth + 1);
  }

  return output;
}

function emit(
  level: LogLevel,
  context: LogContext,
  message: string,
  details?: Record<string, unknown>,
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    operation: context.operation,
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
    ...(context.userId ? { userId: context.userId } : {}),
    ...(context.errorCode ? { errorCode: context.errorCode } : {}),
    ...(details ? { details: redactForLogging(details) } : {}),
  };

  const serialized = JSON.stringify(record);

  switch (level) {
    case "error":
      console.error(serialized);
      break;
    case "warn":
      console.warn(serialized);
      break;
    case "info":
      console.info(serialized);
      break;
    default:
      console.debug(serialized);
  }
}

export function logInfo(
  context: LogContext,
  message: string,
  details?: Record<string, unknown>,
): void {
  emit("info", context, message, details);
}

export function logWarn(
  context: LogContext,
  message: string,
  details?: Record<string, unknown>,
): void {
  emit("warn", context, message, details);
}

export function logError(
  context: LogContext,
  message: string,
  error?: unknown,
  details?: Record<string, unknown>,
): void {
  const errorDetails =
    error === undefined
      ? details
      : {
          error: error,
          ...details,
        };

  emit("error", context, message, errorDetails);
}
