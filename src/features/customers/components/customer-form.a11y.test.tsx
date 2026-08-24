import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, test, vi } from "vitest";

import { CustomerForm } from "@/features/customers/components/customer-form";

import type { CustomerDetailRow } from "../schemas";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

expect.extend(toHaveNoViolations);

function editCustomer(): CustomerDetailRow {
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
    addressLine2: null,
    postalCode: "62704",
    notes: null,
    openDraftCount: 1,
    lastOrderAt: null,
  };
}

describe("customer form accessibility (axe)", () => {
  test("create mode has no violations", async () => {
    const { container } = render(<CustomerForm mode="create" />);

    expect(await axe(container)).toHaveNoViolations();
  });

  test("edit mode with archived copy has no violations", async () => {
    const { container } = render(
      <CustomerForm
        mode="edit"
        customer={{ ...editCustomer(), isActive: false }}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
