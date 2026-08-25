import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { InvoicesGrid } from "./invoices-grid";

import type { InvoiceListPage, InvoiceListRow } from "../queries";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

function row(overrides: Partial<InvoiceListRow> = {}): InvoiceListRow {
  return {
    id: "00000000-0000-4000-8000-00000000d001",
    invoiceNumber: "INV-000042",
    status: "issued",
    orderId: "00000000-0000-4000-8000-000000000001",
    orderNumber: "SO-000100",
    customerId: "00000000-0000-4000-8000-000000000c01",
    customerName: "Acme Retail",
    totalCents: 25998,
    issuedAt: "2026-08-21T10:00:00.000Z",
    voidedAt: null,
    ...overrides,
  };
}

function page(rows: InvoiceListRow[]): InvoiceListPage {
  return {
    rows,
    total: rows.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

const customerOptions = [
  { id: "00000000-0000-4000-8000-000000000c01", name: "Acme Retail" },
  { id: "00000000-0000-4000-8000-000000000c02", name: "Globex Supply" },
];

describe("invoices grid", () => {
  beforeEach(() => {
    mocks.push.mockClear();
  });

  test("renders invoice links, status badges, order links, and downloads", () => {
    render(
      <InvoicesGrid
        page={page([
          row(),
          row({
            id: "00000000-0000-4000-8000-00000000d002",
            invoiceNumber: "INV-000043",
            status: "void",
          }),
        ])}
        customerOptions={customerOptions}
        urlValues={{ status: "all", page: 1, pageSize: 20 }}
      />,
    );

    expect(screen.getByRole("link", { name: "INV-000042" })).toHaveAttribute(
      "href",
      "/accounting/invoices/00000000-0000-4000-8000-00000000d001",
    );
    const voidRow = screen.getByRole("row", {
      name: /INV-000043/,
    });
    expect(within(voidRow).getByText("Void")).toBeInTheDocument();
    const issuedRow = screen.getByRole("row", { name: /INV-000042/ });
    expect(
      within(issuedRow).getByRole("link", { name: "SO-000100" }),
    ).toHaveAttribute(
      "href",
      "/sales/orders/00000000-0000-4000-8000-000000000001",
    );

    const download = within(issuedRow).getByRole("link", {
      name: "Download",
    });
    expect(download).toHaveAttribute(
      "href",
      "/api/invoices/00000000-0000-4000-8000-00000000d001/pdf",
    );
    expect(download).toHaveAttribute("download");
  });

  test("applies customer and issued-date filters through the URL", async () => {
    const user = userEvent.setup();

    render(
      <InvoicesGrid
        page={page([])}
        customerOptions={customerOptions}
        urlValues={{ status: "all", page: 1, pageSize: 20 }}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText("Filter by customer"),
      "00000000-0000-4000-8000-000000000c02",
    );
    await user.type(screen.getByLabelText("Issued from"), "2026-08-01");
    await user.type(screen.getByLabelText("Issued to"), "2026-08-31");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(mocks.push).toHaveBeenCalledWith(
      "/accounting/invoices?customerId=00000000-0000-4000-8000-000000000c02&dateFrom=2026-08-01&dateTo=2026-08-31",
    );
  });

  test("status tabs reset to the first page while keeping other filters", () => {
    render(
      <InvoicesGrid
        page={page([])}
        customerOptions={customerOptions}
        urlValues={{
          status: "all",
          customerId: "00000000-0000-4000-8000-000000000c01",
          dateFrom: "2026-08-01",
          page: 3,
          pageSize: 20,
        }}
      />,
    );

    // Status tabs are links; assert the generated href keeps other
    // filters while resetting pagination.
    expect(screen.getByRole("link", { name: "Void" })).toHaveAttribute(
      "href",
      "/accounting/invoices?status=void&customerId=00000000-0000-4000-8000-000000000c01&dateFrom=2026-08-01",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
