import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  CORRELATION_ID_HEADER,
  isSensitiveKey,
  logError,
  logInfo,
  logWarn,
  newCorrelationId,
  redactForLogging,
} from "@/lib/errors/logging";

interface CapturedRecord {
  level: string;
  message: string;
  operation: string;
  correlationId?: string;
  userId?: string;
  errorCode?: string;
  timestamp?: string;
  details?: Record<string, unknown>;
}

let emitted: CapturedRecord[];

beforeEach(() => {
  emitted = [];

  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    emitted.push(JSON.parse(String(args[0])) as CapturedRecord);
  });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    emitted.push(JSON.parse(String(args[0])) as CapturedRecord);
  });
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    emitted.push(JSON.parse(String(args[0])) as CapturedRecord);
  });
  vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
    emitted.push(JSON.parse(String(args[0])) as CapturedRecord);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function lastEmitted(): CapturedRecord {
  const record = emitted.at(-1);

  if (!record) {
    throw new Error("no structured record was emitted");
  }

  return record;
}

describe("structured logging", () => {
  test("emits single-line JSON with context fields", () => {
    logInfo(
      {
        operation: "order.confirm",
        correlationId: "c-123",
        userId: "u-456",
      },
      "Order confirmed",
    );

    const record = lastEmitted();

    expect(record.level).toBe("info");
    expect(record.message).toBe("Order confirmed");
    expect(record.operation).toBe("order.confirm");
    expect(record.correlationId).toBe("c-123");
    expect(record.userId).toBe("u-456");
    expect(record.timestamp).toBeDefined();
  });

  test("routes levels to the matching console channel", () => {
    logWarn({ operation: "op" }, "careful");
    logError({ operation: "op", errorCode: "INTERNAL_ERROR" }, "boom");

    const warnRecord = emitted[0];
    const errorRecord = emitted[1];

    expect(warnRecord?.level).toBe("warn");
    expect(errorRecord?.level).toBe("error");
    expect(errorRecord?.errorCode).toBe("INTERNAL_ERROR");
  });

  test("captures name and message from thrown errors", () => {
    logError(
      { operation: "db.query", correlationId: "c-1" },
      "Query failed",
      new Error("connection refused"),
    );

    const details = lastEmitted().details as {
      error: { name: string; message: string };
    };

    expect(details.error.name).toBe("Error");
    expect(details.error.message).toBe("connection refused");
  });
});

describe("redaction", () => {
  test("flags sensitive keys case-insensitively across separators", () => {
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("Password")).toBe(true);
    expect(isSensitiveKey("refresh_token")).toBe(true);
    expect(isSensitiveKey("accessToken")).toBe(true);
    expect(isSensitiveKey("Authorization")).toBe(true);
    expect(isSensitiveKey("SUPABASE_SECRET_KEY")).toBe(true);
    expect(isSensitiveKey("customerName")).toBe(false);
    expect(isSensitiveKey("orderTotalCents")).toBe(false);
  });

  test("removes sensitive values at any depth", () => {
    const redacted = redactForLogging({
      form: {
        password: "hunter2",
        nested: [{ api_key: "abc" }],
        email: "ada@example.com",
      },
    }) as {
      form: {
        password: string;
        nested: { api_key: string }[];
        email: string;
      };
    };

    expect(redacted.form.password).toBe("[redacted]");
    expect(redacted.form.nested[0]?.api_key).toBe("[redacted]");
    expect(redacted.form.email).toBe("ada@example.com");
  });

  test("masks Supabase key material inside strings", () => {
    const redacted = redactForLogging({
      note: "key was sb_secret_live_abcdef123 and sb_publishable_pub_456",
    }) as { note: string };

    expect(redacted.note).not.toContain("abcdef123");
    expect(redacted.note).toContain("sb_secret_[redacted]");
    expect(redacted.note).toContain("sb_publishable_[redacted]");
  });

  test("converts errors and dates into safe primitives", () => {
    const redacted = redactForLogging({
      when: new Date("2026-08-22T00:00:00.000Z"),
    }) as { when: string };

    expect(redacted.when).toBe("2026-08-22T00:00:00.000Z");

    const errorShape = redactForLogging({
      err: new RangeError("bad input"),
    }) as { err: { name: string; message: string; stack?: string } };

    expect(errorShape.err.name).toBe("RangeError");
    expect(errorShape.err.stack).toBeDefined();
  });

  test("caps runaway nesting depth", () => {
    const deep = { level: {} } as Record<string, unknown>;
    let cursor = deep;

    for (let i = 0; i < 20; i += 1) {
      const next = {};
      cursor.level = next;
      cursor = next;
    }

    const redacted = JSON.stringify(redactForLogging(deep));

    expect(redacted).toContain("[max-depth]");
  });
});

describe("correlation ids", () => {
  test("generates unique UUID-shaped identifiers", () => {
    const first = newCorrelationId();
    const second = newCorrelationId();

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(second).not.toBe(first);
    expect(CORRELATION_ID_HEADER).toBe("x-correlation-id");
  });
});
