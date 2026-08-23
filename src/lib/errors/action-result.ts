import { z } from "zod";

/**
 * Shared Server Action result and error vocabulary.
 *
 * Browser-safe: actions return these values to client components, so this
 * module must never import database, environment, or server-only code.
 */

export const actionErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "UNIQUE_CONFLICT",
  "INSUFFICIENT_STOCK",
  "LAST_ADMIN",
  "INTERNAL_ERROR",
]);

export type ActionErrorCode = z.infer<typeof actionErrorCodeSchema>;

export interface ActionError {
  code: ActionErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
  correlationId?: string;
  details?: Record<string, unknown>;
}

export interface ActionSuccessResult<T> {
  ok: true;
  data: T;
}

export interface ActionFailureResult {
  ok: false;
  error: ActionError;
}

export type ActionResult<T> = ActionSuccessResult<T> | ActionFailureResult;

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export interface ActionFailureOptions {
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
  correlationId?: string;
}

export function actionFailure(
  code: ActionErrorCode,
  message: string,
  options: ActionFailureOptions = {},
): ActionFailureResult {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
      ...(options.details ? { details: options.details } : {}),
      ...(options.correlationId
        ? { correlationId: options.correlationId }
        : {}),
    },
  };
}

/** Expected business-rule failure thrown by domain services. */
export class DomainError extends Error {
  readonly code: ActionErrorCode;
  readonly fieldErrors?: Record<string, string[]>;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ActionErrorCode,
    message: string,
    options: ActionFailureOptions = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    if (options.fieldErrors) {
      this.fieldErrors = options.fieldErrors;
    }
    if (options.details) {
      this.details = options.details;
    }
  }
}

const VALIDATION_SUMMARY = "Please review the highlighted fields.";

/** Flattens Zod issues into the shared fieldErrors shape. */
export function validationFailure(error: z.ZodError): ActionResult<never> {
  const flattened = z.flattenError(error);

  return actionFailure("VALIDATION_ERROR", VALIDATION_SUMMARY, {
    fieldErrors: flattened.fieldErrors,
  });
}
