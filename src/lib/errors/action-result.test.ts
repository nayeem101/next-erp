import { describe, expect, test } from "vitest";
import { z } from "zod";

import {
  actionErrorCodeSchema,
  actionFailure,
  actionSuccess,
  DomainError,
  validationFailure,
  type ActionResult,
} from "@/lib/errors/action-result";

const testSchema = z.object({
  name: z.string().min(1),
  email: z.string(),
});

describe("action result contract", () => {
  test("exposes the nine documented error codes", () => {
    expect(actionErrorCodeSchema.options).toEqual([
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
  });

  test("wraps success payloads without extra fields", () => {
    const result: ActionResult<{ id: string }> = actionSuccess({ id: "abc" });

    expect(result).toEqual({ ok: true, data: { id: "abc" } });
  });

  test("builds failures with optional attachments only when present", () => {
    const plain = actionFailure("NOT_FOUND", "Missing");
    const full = actionFailure("CONFLICT", "Stale", {
      correlationId: "c-1",
      details: { version: 2 },
      fieldErrors: { status: ["Changed elsewhere"] },
    });

    expect(plain.error).toEqual({ code: "NOT_FOUND", message: "Missing" });
    expect(full.error.correlationId).toBe("c-1");
    expect(full.error.details).toEqual({ version: 2 });
    expect(full.error.fieldErrors).toEqual({ status: ["Changed elsewhere"] });
  });
});

describe("validationFailure", () => {
  test("flattens Zod issues into fieldErrors", () => {
    const parsed = testSchema.safeParse({ name: "", email: "not-an-email" });

    if (parsed.success) {
      throw new Error("expected validation failure");
    }

    const result = validationFailure(parsed.error);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(result.error.fieldErrors ?? {})).toContain("name");
      expect(
        Object.values(result.error.fieldErrors ?? {}).every(
          (messages) => Array.isArray(messages) && messages.length > 0,
        ),
      ).toBe(true);
    }
  });

  test("collects every issue per field", () => {
    const schema = z.object({
      quantity: z.number().int().positive().max(10),
    });

    const parsed = schema.safeParse({ quantity: -3 });

    if (parsed.success) {
      throw new Error("expected validation failure");
    }

    const result = validationFailure(parsed.error);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.fieldErrors?.quantity?.length).toBeGreaterThan(0);
    }
  });
});

describe("DomainError", () => {
  test("carries code, message, and safe details", () => {
    const error = new DomainError("INSUFFICIENT_STOCK", "Not enough stock.", {
      details: { productId: "p-1", requested: 5, available: 2 },
    });

    expect(error.name).toBe("DomainError");
    expect(error.code).toBe("INSUFFICIENT_STOCK");
    expect(error.message).toBe("Not enough stock.");
    expect(error.details).toEqual({
      productId: "p-1",
      requested: 5,
      available: 2,
    });
    expect(error.fieldErrors).toBeUndefined();
  });
});
