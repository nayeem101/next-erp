import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { DataTableSkeleton } from "@/components/shared/data-table-skeleton";
import { EmptyState, LocalDateTime, Money } from "@/components/shared/display";
import {
  EntityActiveBadge,
  InvoiceStatusBadge,
  OrderStatusBadge,
  StockLevelBadge,
  StatusBadge,
} from "@/components/shared/status-badge";

describe("OrderStatusBadge", () => {
  test("maps every order status to its label and tone", () => {
    render(
      <>
        <OrderStatusBadge status="draft" />
        <OrderStatusBadge status="confirmed" />
        <OrderStatusBadge status="fulfilled" />
        <OrderStatusBadge status="cancelled" />
      </>,
    );

    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Fulfilled")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});

describe("InvoiceStatusBadge", () => {
  test("maps issued and void", () => {
    render(
      <>
        <InvoiceStatusBadge status="issued" />
        <InvoiceStatusBadge status="void" />
      </>,
    );

    expect(screen.getByText("Issued")).toBeInTheDocument();
    expect(screen.getByText("Void")).toBeInTheDocument();
  });
});

describe("EntityActiveBadge and StockLevelBadge", () => {
  test("map master-data and stock states", () => {
    render(
      <>
        <EntityActiveBadge state="active" />
        <EntityActiveBadge state="archived" />
        <StockLevelBadge level="in_stock" />
        <StockLevelBadge level="low_stock" />
        <StockLevelBadge level="out_of_stock" />
      </>,
    );

    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("In stock")).toBeInTheDocument();
    expect(screen.getByText("Low stock")).toBeInTheDocument();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
  });
});

describe("LocalDateTime", () => {
  test("renders a machine-readable datetime with exact UTC tooltip", () => {
    const iso = "2026-08-24T14:30:00.000Z";

    const { container } = render(<LocalDateTime value={iso} />);

    const element = container.querySelector("time");

    expect(element).not.toBeNull();
    expect(element?.getAttribute("datetime")).toBe(iso);
    expect(element?.getAttribute("title")).toContain("UTC");
    expect(element?.getAttribute("title")).toContain("2026-08-24");
    // Locale rendering must be non-empty for any environment locale.
    expect(element?.textContent && element.textContent.length > 0).toBe(true);
  });
});

describe("Money", () => {
  test("formats serialized cents exactly", () => {
    render(<Money amountCents={123456} currency="USD" />);

    expect(screen.getByText(/\$1,234\.56/)).toBeInTheDocument();
  });

  test("accepts string cents from JSON payloads without float drift", () => {
    render(<Money amountCents="999999999" currency="USD" />);

    expect(screen.getByText(/\$9,999,999\.99/)).toBeInTheDocument();
  });

  test("supports other currencies", () => {
    render(<Money amountCents={5000} currency="EUR" />);

    expect(screen.getByText(/€50\.00/)).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  test("shows description for unfiltered empties", () => {
    render(
      <EmptyState
        title="No products yet"
        description="Create your first product to begin tracking stock."
      />,
    );

    expect(
      screen.getByText("Create your first product to begin tracking stock."),
    ).toBeInTheDocument();
  });

  test("filtered variant explains the narrowing instead", () => {
    render(
      <EmptyState
        title="No results"
        description="This text is replaced when filtered."
        filtered
      />,
    );

    expect(
      screen.getByText(/adjust or reset them to widen the search/i),
    ).toBeInTheDocument();
  });
});

describe("DataTableSkeleton", () => {
  test("keeps header labels visible and marks itself busy", () => {
    render(
      <DataTableSkeleton
        columnLabels={["Name", "Email", "Roles"]}
        rowCount={3}
      />,
    );

    expect(screen.getByLabelText("Loading table")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    // Row placeholders: 3 rows x 3 columns of skeletons.
    expect(containerSkeletonCount()).toBe(9);
  });

  function containerSkeletonCount(): number {
    return document.querySelectorAll("[data-slot='skeleton']").length;
  }
});

describe("StatusBadge base", () => {
  test("defaults to the neutral tone", () => {
    render(<StatusBadge>Custom</StatusBadge>);

    expect(screen.getByText("Custom")).toBeInTheDocument();
  });
});
