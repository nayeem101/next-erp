import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CustomerOrdersTable } from "@/features/customers/components/customer-orders-table";
import { CustomerStatusActions } from "@/features/customers/components/customer-status-actions";
import type {
  CustomerDetailRow,
  CustomerOrderPage,
} from "@/features/customers/schemas";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  setCustomerActiveAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/features/customers/actions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setCustomerActiveAction: mocks.setCustomerActiveAction,
}));

function detail(overrides: Partial<CustomerDetailRow>): CustomerDetailRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Acme Retail",
    email: "buyer@acme.com",
    phone: "+1 555-0100",
    companyName: null,
    city: "Springfield",
    region: "IL",
    countryCode: "US",
    isActive: true,
    orderCount: 4,
    confirmedSalesCents: 250_000,
    createdAt: "2026-08-01T10:00:00.000Z",
    addressLine1: "1 Main St",
    addressLine2: "Suite 5",
    postalCode: "62704",
    notes: null,
    openDraftCount: 1,
    lastOrderAt: null,
    ...overrides,
  };
}

function orderPage(): CustomerOrderPage {
  return {
    rows: [
      {
        id: "00000000-0000-4000-8000-00000000a001",
        orderNumber: "SO-000101",
        status: "fulfilled",
        version: 2,
        totalCents: 150_000,
        currencyCode: "USD",
        createdAt: "2026-07-15T09:00:00.000Z",
        confirmedAt: "2026-07-16T09:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-00000000a002",
        orderNumber: "SO-000102",
        status: "draft",
        version: 1,
        totalCents: 25_000,
        currencyCode: "USD",
        createdAt: "2026-08-10T09:00:00.000Z",
        confirmedAt: null,
      },
    ],
    total: 2,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
});

describe("CustomerStatusActions", () => {
  test("hides actions without admin or sales roles", () => {
    render(
      <CustomerStatusActions
        customer={detail({})}
        currentRoles={["inventory"]}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link", { name: /edit/i })).toBeNull();
  });

  test("archive confirms then calls the action with false and refreshes", async () => {
    const user = userEvent.setup();

    mocks.setCustomerActiveAction.mockResolvedValue({
      ok: true,
      data: { customerId: detail({}).id, isActive: false },
    });

    render(
      <CustomerStatusActions customer={detail({})} currentRoles={["sales"]} />,
    );

    await user.click(screen.getByRole("button", { name: /^archive$/i }));

    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /^archive$/i }),
    );

    await waitFor(() => {
      expect(mocks.setCustomerActiveAction).toHaveBeenCalledWith({
        customerId: detail({}).id,
        isActive: false,
      });
    });
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  test("restore keeps the dialog open on conflicts with the error visible", async () => {
    const user = userEvent.setup();

    mocks.setCustomerActiveAction.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "That customer no longer exists." },
    });

    render(
      <CustomerStatusActions
        customer={detail({ isActive: false })}
        currentRoles={["admin"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^restore$/i }));
    const dialog = screen.getByRole("dialog");

    await user.click(
      within(dialog).getByRole("button", { name: /^restore$/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("CustomerOrdersTable", () => {
  test("renders order links, status badges, totals, and dashboards for unconfirmed", () => {
    render(
      <CustomerOrdersTable
        customerId="00000000-0000-4000-8000-000000000001"
        page={orderPage()}
        urlValues={{ page: 1, pageSize: 10 }}
      />,
    );

    const draftLink = screen.getByRole("link", { name: "SO-000102" });

    expect(draftLink).toHaveAttribute(
      "href",
      "/sales/orders/00000000-0000-4000-8000-00000000a002",
    );
    expect(screen.getAllByText(/draft/i).length).toBeGreaterThan(0);
    expect(screen.getByText("$1,500.00").closest("tr")).toHaveTextContent(
      "Fulfilled",
    );
  });

  test("shows the empty state when the customer has no orders", () => {
    render(
      <CustomerOrdersTable
        customerId="00000000-0000-4000-8000-000000000001"
        page={{ rows: [], total: 0, page: 1, pageSize: 10, totalPages: 1 }}
        urlValues={{ page: 1, pageSize: 10 }}
      />,
    );

    expect(screen.getByText(/no orders yet/i)).toBeInTheDocument();
  });
});
