import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CustomersGrid } from "@/features/customers/components/customers-grid";
import type {
  CustomerListPage,
  CustomerListRow,
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

function row(overrides: Partial<CustomerListRow>): CustomerListRow {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000001",
    name: overrides.name ?? "Acme Retail",
    email: overrides.email ?? "buyer@acme.com",
    phone: overrides.phone ?? "+1 555-0100",
    companyName: overrides.companyName ?? null,
    city: overrides.city ?? "Springfield",
    region: overrides.region ?? "IL",
    countryCode: overrides.countryCode ?? "US",
    isActive: overrides.isActive ?? true,
    orderCount: overrides.orderCount ?? 3,
    confirmedSalesCents: overrides.confirmedSalesCents ?? 125_000,
    createdAt: overrides.createdAt ?? "2026-08-01T10:00:00.000Z",
  };
}

const urlValues = {
  search: undefined,
  status: "all",
  sort: "name",
  page: 1,
  pageSize: 20,
} as const;

function makePage(rows: CustomerListRow[]): CustomerListPage {
  return {
    rows,
    total: rows.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.setCustomerActiveAction.mockReset();
});

describe("CustomersGrid rendering", () => {
  test("renders contact, location, order count, sales money, and status", () => {
    render(
      <CustomersGrid
        page={makePage([
          row({}),
          row({
            id: "00000000-0000-4000-8000-000000000002",
            name: "Buyer Co",
            companyName: "Buyer Corporation",
            email: "ap@buyerco.com",
            phone: null,
            region: null,
            isActive: false,
          }),
        ])}
        currentRoles={["admin"]}
        urlValues={urlValues}
      />,
    );

    expect(screen.getByText("Acme Retail")).toBeInTheDocument();
    expect(screen.getAllByText("+1 555-0100").length).toBeGreaterThan(0);
    const locationCell = screen
      .getByText("buyer@acme.com")
      .closest("tr")
      ?.querySelector("td:nth-child(3)");

    expect(locationCell?.textContent).toBe("Springfield, IL, US");
    expect(screen.getByText("Buyer Corporation")).toBeInTheDocument();

    const acmeRow = screen.getByText("buyer@acme.com").closest("tr");
    expect(acmeRow).toHaveTextContent("3");
    expect(acmeRow).toHaveTextContent("Active");

    const buyerRow = screen.getByText("ap@buyerco.com").closest("tr");
    expect(buyerRow).toHaveTextContent("Archived");
  });

  test("shows the unfiltered empty state for a fresh workspace", () => {
    render(
      <CustomersGrid
        page={makePage([])}
        currentRoles={["admin"]}
        urlValues={urlValues}
      />,
    );

    expect(screen.getByText(/no customers yet/i)).toBeInTheDocument();
  });

  test("shows the filtered empty state when filters hide everything", () => {
    render(
      <CustomersGrid
        page={makePage([])}
        currentRoles={["admin"]}
        urlValues={{ ...urlValues, search: "zzz" }}
      />,
    );

    expect(screen.getAllByText(/no results/i).length).toBeGreaterThan(0);
  });

  test("hides manage actions from inventory and keeps read-only view", () => {
    render(
      <CustomersGrid
        page={makePage([row({})])}
        currentRoles={["inventory"]}
        urlValues={urlValues}
      />,
    );

    expect(screen.queryByRole("link", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /archive/i })).toBeNull();
    expect(
      screen.getByRole("table", { name: "Customers" }),
    ).toBeInTheDocument();
  });

  test("archive flow confirms then calls the action with false", async () => {
    const user = userEvent.setup();
    const target = row({});

    mocks.setCustomerActiveAction.mockResolvedValue({
      ok: true,
      data: { customerId: target.id, isActive: false },
    });

    render(
      <CustomersGrid
        page={makePage([target])}
        currentRoles={["sales"]}
        urlValues={urlValues}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^archive$/i }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Archive customer" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /^archive$/i }),
    );

    await waitFor(() => {
      expect(mocks.setCustomerActiveAction).toHaveBeenCalledWith({
        customerId: target.id,
        isActive: false,
      });
    });
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  test("surfaces conflicts inline without closing the dialog", async () => {
    const user = userEvent.setup();
    const target = row({});

    mocks.setCustomerActiveAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "That customer no longer exists.",
      },
    });

    render(
      <CustomersGrid
        page={makePage([target])}
        currentRoles={["sales"]}
        urlValues={urlValues}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^archive$/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /^archive$/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("status segments expose canonical hrefs with current marker", () => {
    render(
      <CustomersGrid
        page={makePage([row({})])}
        currentRoles={["admin"]}
        urlValues={{ ...urlValues, status: "active" }}
      />,
    );

    const nav = screen.getByRole("navigation", {
      name: "Filter by status",
    });
    const active = within(nav).getByRole("link", { name: "Active" });
    const archived = within(nav).getByRole("link", { name: "Archived" });
    const all = within(nav).getByRole("link", { name: "All" });

    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveAttribute("href", "/customers?status=active");
    expect(archived).toHaveAttribute("href", "/customers?status=archived");
    expect(all).toHaveAttribute("href", "/customers");
  });

  test("sort clicks map column order to allowlisted sort values", async () => {
    const user = userEvent.setup();

    render(
      <CustomersGrid
        page={makePage([row({})])}
        currentRoles={["admin"]}
        urlValues={urlValues}
      />,
    );

    await user.click(screen.getByRole("button", { name: /name/i }));

    expect(mocks.push).toHaveBeenCalledWith("/customers?sort=name_desc");

    mocks.push.mockClear();

    await user.click(screen.getByRole("button", { name: /contact/i }));

    expect(mocks.push).toHaveBeenCalledWith("/customers?sort=email");
  });

  test("pagination renders server totals and navigates pages", async () => {
    const user = userEvent.setup();

    render(
      <CustomersGrid
        page={{ ...makePage([row({})]), total: 41, totalPages: 3 }}
        currentRoles={["admin"]}
        urlValues={urlValues}
      />,
    );

    expect(screen.getByText(/of 41/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to page 2" }));

    expect(mocks.push).toHaveBeenCalledWith("/customers?page=2");
  });
});
