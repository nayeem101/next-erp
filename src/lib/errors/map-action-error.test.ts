import { describe, expect, test, vi } from "vitest";

import { DomainError } from "@/lib/errors/action-result";
import { mapActionError } from "@/lib/errors/map-action-error";

describe("mapActionError", () => {
  test("rethrows Next.js redirect and not-found control flow", () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;",
    });
    const notFound = Object.assign(new Error("404"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });

    expect(() => mapActionError(redirect, "c-1")).toThrow(redirect);
    expect(() => mapActionError(notFound, "c-1")).toThrow(notFound);
  });

  test("passes DomainError through with its attachments", () => {
    const domain = new DomainError("LAST_ADMIN", "Keep one admin.", {
      details: { activeAdmins: 1 },
    });

    const result = mapActionError(domain, "c-9");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "LAST_ADMIN",
        message: "Keep one admin.",
        details: { activeAdmins: 1 },
        correlationId: "c-9",
      },
    });
  });

  test.each([
    ["23505", "UNIQUE_CONFLICT"],
    ["23503", "CONFLICT"],
    ["23514", "CONFLICT"],
    ["40001", "CONFLICT"],
  ])("maps PostgreSQL code %s to %s", (pgCode, expectedCode) => {
    const error = Object.assign(new Error("db"), { code: pgCode });

    const result = mapActionError(error, "c-2");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe(expectedCode);
      expect(result.error.correlationId).toBe("c-2");
      expect(result.error.message).not.toContain(pgCode);
      expect(JSON.stringify(result.error)).not.toContain("constraint");
    }
  });

  test("returns INTERNAL_ERROR for unknown failures without leaking internals", () => {
    const logSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const secret = new Error("password=hunter2 at internal/file.ts:1");
      const result = mapActionError(secret, "c-3");

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error.code).toBe("INTERNAL_ERROR");
        expect(result.error.correlationId).toBe("c-3");
        expect(JSON.stringify(result.error)).not.toContain("hunter2");
        expect(JSON.stringify(result.error)).not.toContain("internal/file.ts");
      }

      // The raw error is still logged server-side.
      expect(logSpy).toHaveBeenCalledTimes(1);
    } finally {
      logSpy.mockRestore();
    }
  });
});
