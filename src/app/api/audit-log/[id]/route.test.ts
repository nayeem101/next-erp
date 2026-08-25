/** @vitest-environment node */
import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  actionContext: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("@/lib/auth/guards", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActionContext: mocks.actionContext,
}));

vi.mock("@/features/audit/queries", () => ({
  getAuditEventDetail: mocks.detail,
}));

function adminContext() {
  return {
    ok: true as const,
    user: {
      id: "00000000-0000-4000-8000-00000000aa01",
      email: "admin@example.com",
      roles: ["admin"] as const,
      displayName: "Alex Admin",
    },
    correlationId: "corr-1",
  };
}

describe("audit detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.DATABASE_URL =
      process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

    void (async () => {
      const { resetServerEnvCacheForTests } = await import("@/lib/env/server");
      resetServerEnvCacheForTests();
    })();
  });

  test("serves sanitized details to admins with no-store caching", async () => {
    mocks.actionContext.mockResolvedValue(adminContext());
    mocks.detail.mockResolvedValue({
      id: "00000000-0000-4000-8000-00000000e001",
      action: "order.confirmed",
      entityType: "order",
      entityId: "00000000-0000-4000-8000-00000000a001",
      createdAt: "2026-08-26T00:00:00.000Z",
      metadata: { after: { status: "confirmed" } },
    });

    const response = await GET(new Request("https://x") as never, {
      params: Promise.resolve({
        id: "00000000-0000-4000-8000-00000000e001",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");

    const body = (await response.json()) as {
      metadata: Record<string, unknown>;
    };
    expect(body.metadata.after).toEqual({ status: "confirmed" });
  });

  test.each([
    ["inventory viewer", ["inventory"]],
    ["anonymous visitor", []],
  ])("%s is forbidden from reading audit details", async (_name, roles) => {
    mocks.actionContext.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "Not allowed." },
      user: { id: "u1", roles, displayName: "X" },
      correlationId: "corr-2",
    });

    const response = await GET(new Request("https://x") as never, {
      params: Promise.resolve({
        id: "00000000-0000-4000-8000-00000000e001",
      }),
    });

    expect(response.status).toBe(403);
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  test("malformed ids and unknown events return 404", async () => {
    mocks.actionContext.mockResolvedValue(adminContext());

    const malformed = await GET(new Request("https://x") as never, {
      params: Promise.resolve({ id: "../../etc/passwd" }),
    });
    expect(malformed.status).toBe(404);

    mocks.detail.mockResolvedValue(null);
    const missing = await GET(new Request("https://x") as never, {
      params: Promise.resolve({
        id: "00000000-0000-4000-8000-00000000dead",
      }),
    });
    expect(missing.status).toBe(404);
  });
});
