import "server-only";

import {
  actionFailure,
  DomainError,
  type ActionErrorCode,
  type ActionResult,
} from "@/lib/errors/action-result";
import { logError } from "@/lib/errors/logging";

/**
 * Maps unexpected and database-level errors to the shared action contract.
 *
 * Expected failures arrive as `DomainError`; PostgreSQL constraint violations
 * map to stable vocabulary without leaking constraint names or SQL text;
 * Next.js redirect/not-found control flow is rethrown untouched; anything
 * else logs server-side and returns a generic internal error.
 */

interface PostgresLikeError {
  code?: unknown;
  constraint?: unknown;
}

const POSTGRES_CONFLICT_CODES = new Set([
  "23503", // foreign_key_violation
  "23514", // check_violation
  "23001", // restrict_violation
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);

const POSTGRES_UNIQUE_CODES = new Set(["23505"]);

const NEXT_CONTROL_FLOW_PREFIXES = [
  "NEXT_REDIRECT",
  "NEXT_HTTP_ERROR_FALLBACK",
];

interface DigestCarrier {
  digest?: unknown;
}

export function isNextControlFlow(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return false;
  }

  const { digest } = error as DigestCarrier;

  return (
    typeof digest === "string" &&
    NEXT_CONTROL_FLOW_PREFIXES.some((prefix) => digest.startsWith(prefix))
  );
}

export function toPostgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = error as PostgresLikeError;

  return typeof candidate.code === "string" ? candidate.code : undefined;
}

function messageForPostgresCode(code: string): {
  errorCode: ActionErrorCode;
  message: string;
} {
  if (POSTGRES_UNIQUE_CODES.has(code)) {
    return {
      errorCode: "UNIQUE_CONFLICT",
      message: "That value is already in use. Choose another and try again.",
    };
  }

  if (POSTGRES_CONFLICT_CODES.has(code)) {
    return {
      errorCode: "CONFLICT",
      message:
        "The change conflicts with the current state of your data. Refresh and try again.",
    };
  }

  return { errorCode: "INTERNAL_ERROR", message: "Something went wrong." };
}

/**
 * Terminal error adapter for Server Actions. Never throws for expected or
 * unexpected application failures; rethrows only Next.js control flow.
 */
export function mapActionError(
  error: unknown,
  correlationId: string,
): ActionResult<never> {
  if (isNextControlFlow(error)) {
    throw error;
  }

  if (error instanceof DomainError) {
    return actionFailure(error.code, error.message, {
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      ...(error.details ? { details: error.details } : {}),
      correlationId,
    });
  }

  const postgresCode = toPostgresErrorCode(error);

  if (postgresCode) {
    const mapped = messageForPostgresCode(postgresCode);

    logError(
      {
        operation: "action.postgres-error",
        correlationId,
        errorCode: mapped.errorCode,
      },
      "Database constraint rejected the operation.",
      error,
      { postgresCode },
    );

    return actionFailure(mapped.errorCode, mapped.message, { correlationId });
  }

  logError(
    {
      operation: "action.unexpected-error",
      correlationId,
      errorCode: "INTERNAL_ERROR",
    },
    "Unexpected error handled by action boundary.",
    error,
  );

  return actionFailure(
    "INTERNAL_ERROR",
    "Something went wrong. Try again, or contact support if it keeps happening.",
    { correlationId },
  );
}
