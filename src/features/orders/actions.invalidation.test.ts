import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  cancelOrderAction,
  confirmOrderAction,
  createDraftOrderAction,
  fulfillOrderAction,
} from "./actions";

const mocks = vi.hoisted(() => ({
  actionContext: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: mocks.updateTag,
}));

vi.mock("@/lib/auth/guards", () => ({
  getActionContext: mocks.actionContext,
}));

vi.mock("./service", () => ({
  createDraftOrder: vi.fn().mockResolvedValue({
    orderId: "00000000-0000-4000-8000-00000000a001",
    orderNumber: "SO-000001",
    version: 1,
    customerId: "00000000-0000-4000-8000-00000000c001",
  }),
  updateDraftOrder: vi.fn().mockResolvedValue({
    orderId: "00000000-0000-4000-8000-00000000a001",
    orderNumber: "SO-000001",
    version: 2,
  }),
}));

vi.mock("./confirm", () => ({
  confirmOrder: vi.fn().mockResolvedValue({
    orderId: "00000000-0000-4000-8000-00000000a001",
    orderNumber: "SO-000001",
    customerId: "00000000-0000-4000-8000-00000000c001",
    version: 2,
    invoiceId: "00000000-0000-4000-8000-00000000d001",
    invoiceNumber: "INV-000001",
    totalCents: 1000,
  }),
}));

vi.mock("./lifecycle", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    fulfillOrder: vi.fn().mockResolvedValue({
      orderId: "00000000-0000-4000-8000-00000000a001",
      customerId: "00000000-0000-4000-8000-00000000c001",
      version: 3,
      status: "fulfilled",
    }),
    cancelOrder: vi.fn().mockResolvedValue({
      orderId: "00000000-0000-4000-8000-00000000a001",
      customerId: "00000000-0000-4000-8000-00000000c001",
      version: 3,
      status: "cancelled",
      reversed: true,
    }),
  };
});

const orderId = "00000000-0000-4000-8000-00000000a001";
const customerId = "00000000-0000-4000-8000-00000000c001";

function tags(): string[] {
  return mocks.updateTag.mock.calls.map((call) => call[0] as string);
}

describe("mutation dashboard-tag invalidation matrix", () => {
  beforeEach(() => {
    mocks.updateTag.mockClear();
    mocks.actionContext.mockResolvedValue({
      ok: true as const,
      user: {
        id: "00000000-0000-4000-8000-00000000aa01",
        email: "admin@example.com",
        roles: ["admin"] as const,
        displayName: "Alex Admin",
      },
      correlationId: "corr-1",
    });
  });

  test("draft creation touches recent-orders only among dashboard tags", async () => {
    const result = await createDraftOrderAction({
      customerId,
      lines: [{ productId: orderId, quantity: 1 }],
    });

    expect(result.ok).toBe(true);
    expect(tags()).toEqual(["orders", "dashboard:recent-orders", "audit-log"]);
  });

  test("confirmation invalidates every documented dashboard tag", async () => {
    const result = await confirmOrderAction({ orderId, version: 1 });

    expect(result.ok).toBe(true);

    const invalidated = new Set(tags());

    for (const expected of [
      `orders:00000000-0000-4000-8000-00000000a001`,
      `customers:00000000-0000-4000-8000-00000000c001`,
      "products",
      "invoices",
      "ledger",
      "dashboard:revenue",
      "dashboard:top-products",
      "dashboard:low-stock",
      "dashboard:recent-orders",
    ]) {
      expect(invalidated.has(expected)).toBe(true);
    }
  });

  test("fulfillment touches recent-orders without revenue aggregates", async () => {
    const result = await fulfillOrderAction({ orderId, version: 2 });

    expect(result.ok).toBe(true);

    const invalidated = new Set(tags());

    expect(invalidated.has(`orders:00000000-0000-4000-8000-00000000a001`)).toBe(
      true,
    );
    expect(invalidated.has("dashboard:recent-orders")).toBe(true);
    expect(invalidated.has("dashboard:revenue")).toBe(false);
    expect(invalidated.has("dashboard:top-products")).toBe(false);
  });

  test("confirmed cancellation matches confirmation breadth", async () => {
    const result = await cancelOrderAction({
      orderId,
      version: 2,
      reason: "reversal",
    });

    expect(result.ok).toBe(true);

    const invalidated = new Set(tags());

    expect(invalidated.has("dashboard:revenue")).toBe(true);
    expect(invalidated.has("dashboard:top-products")).toBe(true);
    expect(invalidated.has("dashboard:recent-orders")).toBe(true);
    expect(invalidated.has("invoices")).toBe(true);
  });
});
