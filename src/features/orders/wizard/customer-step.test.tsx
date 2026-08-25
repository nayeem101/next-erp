import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { CustomerStep } from "./customer-step";
import { createOrderWizardStore } from "./store";

import type { ActiveCustomerOption } from "../selectors";

function customer(
  overrides: Partial<ActiveCustomerOption> = {},
): ActiveCustomerOption {
  return {
    id: "c1",
    name: "Acme Retail",
    companyName: "Acme Holdings",
    email: "buyer@acme.com",
    phone: "+1 555-0100",
    city: "Springfield",
    region: "IL",
    countryCode: "US",
    ...overrides,
  };
}

describe("customer step", () => {
  test("shows the prerequisite empty state when no active customers exist", () => {
    const store = createOrderWizardStore();

    render(<CustomerStep store={store} options={[]} />);

    expect(screen.getByText("No active customers")).toBeDefined();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  test("opens the listbox, filters by query, and selects with Enter", async () => {
    const store = createOrderWizardStore();
    const user = userEvent.setup();

    const options = [
      customer(),
      customer({
        id: "c2",
        name: "Globex Supply",
        email: "ops@globex.com",
        city: "Shelbyville",
      }),
    ];

    render(<CustomerStep store={store} options={options} />);

    const combo = screen.getByRole("combobox");
    await user.click(combo);

    const listbox = screen.getByRole("listbox", { name: "Active customers" });
    const visibleOptions = within(listbox).getAllByRole("option");
    expect(visibleOptions).toHaveLength(2);

    await user.type(combo, "globex");

    const narrowed = within(listbox).getAllByRole("option");
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]?.textContent).toContain("Globex Supply");

    await user.keyboard("{Enter}");

    // Selection lands in the store and the contact preview renders.
    expect(store.getState().customerId).toBe("c2");

    const preview = screen.getByRole("group", {
      name: "Selected customer: Globex Supply",
    });
    expect(within(preview).getByText("ops@globex.com")).toBeDefined();

    // Combobox shows the chosen customer and closes.
    expect(combo.getAttribute("aria-expanded")).toBe("false");
  });

  test("keyboard arrow keys move the active option before selection", async () => {
    const store = createOrderWizardStore();
    const user = userEvent.setup();

    const options = [customer(), customer({ id: "c2", name: "Globex Supply" })];

    render(<CustomerStep store={store} options={options} />);

    const combo = screen.getByRole("combobox");
    await user.click(combo);
    await user.keyboard("{ArrowDown}");

    const listbox = screen.getByRole("listbox", { name: "Active customers" });
    const visibleOptions = within(listbox).getAllByRole("option");

    expect(visibleOptions[1]).toHaveAttribute("data-active");

    await user.keyboard("{Enter}");
    expect(store.getState().customerId).toBe("c2");
  });

  test("clicking an option selects it and the preview can be cleared", async () => {
    const store = createOrderWizardStore();
    const user = userEvent.setup();

    render(<CustomerStep store={store} options={[customer()]} />);

    await user.click(screen.getByRole("combobox"));

    const listbox = screen.getByRole("listbox");
    const firstOption = within(listbox).getAllByRole("option").at(0);

    if (!firstOption) {
      throw new Error("expected at least one option");
    }

    await user.click(firstOption);

    expect(store.getState().customerName).toBe("Acme Retail");
    expect(
      screen.getByRole("group", { name: "Selected customer: Acme Retail" }),
    ).toBeDefined();

    // Deselecting through the store clears the preview.
    store.getState().setCustomer(null);
    expect(screen.queryByText(/Selected customer:/)).toBeNull();
  });

  test("no-match queries surface an inline empty message", async () => {
    const store = createOrderWizardStore();
    const user = userEvent.setup();

    render(<CustomerStep store={store} options={[customer()]} />);

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "zzz");

    expect(screen.getByText(/No customers match/)).toBeDefined();
  });
});
