import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CustomerForm } from "@/features/customers/components/customer-form";
import type { CustomerDetailRow } from "@/features/customers/schemas";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/features/customers/actions", () => ({
  createCustomerAction: mocks.createCustomerAction,
  updateCustomerAction: mocks.updateCustomerAction,
}));

function editCustomer(): CustomerDetailRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Acme Retail",
    email: "buyer@acme.com",
    phone: "+1 555-0100",
    companyName: "Acme Corp",
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

async function fillRequiredFields(
  user: Awaited<ReturnType<typeof userEvent.setup>>,
  email = "buyer@example.com",
): Promise<void> {
  const values: [RegExp, string][] = [
    [/^name$/i, "New Buyer"],
    [/email/i, email],
    [/address line 1/i, "9 Elm St"],
    [/^city$/i, "Shelbyville"],
    [/postal code/i, "55555"],
    [/country code/i, "US"],
  ];

  for (const [label, value] of values) {
    const input = screen.getByLabelText(label);

    await user.clear(input);
    await user.type(input, value);
  }
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
});

describe("CustomerForm create mode", () => {
  test("submits normalized email and country code, blank optionals dropped", async () => {
    const user = userEvent.setup();

    mocks.createCustomerAction.mockResolvedValue({
      ok: true,
      data: { customerId: "00000000-0000-4000-8000-000000009999" },
    });

    render(<CustomerForm mode="create" />);

    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: /create customer/i }));

    await waitFor(() => {
      expect(mocks.createCustomerAction).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New Buyer",
          email: "buyer@example.com",
          countryCode: "US",
        }),
      );
    });

    const payload = mocks.createCustomerAction.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(payload.phone).toBeUndefined();
    expect(payload.companyName).toBeUndefined();
    expect(payload.addressLine2).toBeUndefined();
    expect(mocks.push).toHaveBeenCalledWith("/customers");
  });

  test("blocks submit with inline validation for bad email", async () => {
    const user = userEvent.setup();

    render(<CustomerForm mode="create" />);

    await fillRequiredFields(user, "not-an-email");

    await user.click(screen.getByRole("button", { name: /create customer/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/valid email/i).length).toBeGreaterThan(0);
    });
    expect(mocks.createCustomerAction).not.toHaveBeenCalled();
  });

  test("maps duplicate-email conflicts onto the email field", async () => {
    const user = userEvent.setup();

    mocks.createCustomerAction.mockResolvedValue({
      ok: false,
      error: {
        code: "UNIQUE_CONFLICT",
        message:
          "A customer with this email already exists. Emails are case-insensitive.",
      },
    });

    render(<CustomerForm mode="create" />);

    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: /create customer/i }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/already exists/i);

    // The draft survives so the user can correct the email only.
    expect(screen.getByLabelText(/name/i).value).toBe("New Buyer");
  });
});

describe("CustomerForm edit mode", () => {
  test("prefills all fields and submits the customerId", async () => {
    const user = userEvent.setup();

    mocks.updateCustomerAction.mockResolvedValue({
      ok: true,
      data: { customerId: editCustomer().id },
    });

    render(<CustomerForm mode="edit" customer={editCustomer()} />);

    expect(screen.getByLabelText(/^name$/i).value).toBe("Acme Retail");
    expect(screen.getByLabelText(/company/i).value).toBe("Acme Corp");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mocks.updateCustomerAction).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: "00000000-0000-4000-8000-000000000001",
          email: "buyer@acme.com",
        }),
      );
    });
  });

  test("shows archived-state copy while keeping edits possible", () => {
    render(
      <CustomerForm
        mode="edit"
        customer={{ ...editCustomer(), isActive: false }}
      />,
    );

    expect(
      screen.getByText(/archived — edits are allowed/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled();
  });

  test("uppercases country input as the user types", async () => {
    const user = userEvent.setup();

    render(<CustomerForm mode="create" />);

    const country = screen.getByLabelText(/country code/i);

    await user.type(country, "d");

    expect((country as HTMLInputElement).value).toBe("D");

    await user.type(country, "e");

    expect((country as HTMLInputElement).value).toBe("DE");
  });
});
