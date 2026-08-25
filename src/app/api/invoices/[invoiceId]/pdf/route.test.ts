/** @vitest-environment node */
import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "./route";

import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  actionContext: vi.fn(),
  getInvoice: vi.fn(),
  getInvoiceLines: vi.fn(),
}));

vi.mock("@/lib/auth/guards", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActionContext: mocks.actionContext,
}));

vi.mock("@/features/invoices/queries", () => ({
  getInvoice: mocks.getInvoice,
  getInvoiceLines: mocks.getInvoiceLines,
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

const invoiceFixture = {
  id: "00000000-0000-4000-8000-00000000dd01",
  invoiceNumber: "INV-001234",
  status: "issued" as const,
  currencyCode: "USD",
  orderId: "00000000-0000-4000-8000-00000000bb01",
  orderNumber: "SO-000100",
  customerId: "00000000-0000-4000-8000-00000000cc01",
  customerName: "Acme Retail",
  sellerSnapshot: {
    name: "Seller Co",
    email: "s@e.com",
    addressLine1: "a",
    city: "c",
    postalCode: "p",
    countryCode: "US",
  },
  billToSnapshot: {
    name: "Buyer Co",
    email: "b@e.com",
    addressLine1: "x",
    city: "y",
    postalCode: "z",
    countryCode: "US",
  },
  subtotalCents: 1000,
  totalCents: 1000,
  issuedAt: "2026-08-01T00:00:00.000Z",
  voidedAt: null,
};

async function resetEnvCache(): Promise<void> {
  const { resetServerEnvCacheForTests } = await import("@/lib/env/server");
  resetServerEnvCacheForTests();
}

describe("invoice pdf route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_test_key";
    process.env.DATABASE_URL =
      process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key";
    process.env.COMPANY_NAME = "Test Seller Co";

    void resetEnvCache();
  });

  test("authenticated admin receives an attachment with a safe filename", async () => {
    mocks.actionContext.mockResolvedValue(adminContext());
    mocks.getInvoice.mockResolvedValue(invoiceFixture);
    mocks.getInvoiceLines.mockResolvedValue([]);

    const response = await GET(new Request("https://x") as NextRequest, {
      params: Promise.resolve({ invoiceId: invoiceFixture.id }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="INV-001234.pdf"',
    );
    expect(response.headers.get("Cache-Control")).toContain("no-store");

    // Real render: bytes start with the PDF magic header.
    const bytes = await response.arrayBuffer();
    const header = String.fromCharCode(...new Uint8Array(bytes.slice(0, 5)));
    expect(header).toBe("%PDF-");
  });

  test.each([
    ["inventory viewer", ["inventory"]],
    ["anonymous visitor", []],
  ])("%s is forbidden from downloading PDFs", async (_name, roles) => {
    mocks.actionContext.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "Not allowed." },
      user: { id: "u1", roles, displayName: "X" },
      correlationId: "corr-2",
    });

    const response = await GET(new Request("https://x") as NextRequest, {
      params: Promise.resolve({ invoiceId: invoiceFixture.id }),
    });

    expect(response.status).toBe(403);
  });

  test("malformed and unknown ids return 404 without leaking existence", async () => {
    mocks.actionContext.mockResolvedValue(adminContext());
    mocks.getInvoice.mockResolvedValue(null);
    mocks.getInvoiceLines.mockResolvedValue([]);

    const malformed = await GET(new Request("https://x") as NextRequest, {
      params: Promise.resolve({ invoiceId: "../../etc/passwd" }),
    });
    expect(malformed.status).toBe(404);

    const missing = await GET(new Request("https://x") as NextRequest, {
      params: Promise.resolve({
        invoiceId: "00000000-0000-4000-8000-00000000dead",
      }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not found");
  });
});
