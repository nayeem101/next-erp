import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { createOrderWizardStore } from "./store";
import { WizardShell } from "./wizard-shell";

import type { ActiveProductOption } from "../selectors";

function product(
  overrides: Partial<ActiveProductOption> = {},
): ActiveProductOption {
  return {
    id: "p1",
    sku: "SKU-1",
    name: "Drill",
    unitPriceCents: 1299,
    stockOnHand: 50,
    ...overrides,
  };
}

const customer = {
  id: "c1",
  name: "Buyer Co",
  companyName: null,
  email: "buyer@example.com",
  phone: null,
  city: "Springfield",
  region: null,
  countryCode: "US",
};

describe("wizard shell", () => {
  test("renders progress rail with current step and completed jumps", async () => {
    const store = createOrderWizardStore();
    const user = userEvent.setup();

    render(<WizardShell store={store} />);

    expect(screen.getByRole("heading", { name: "Customer" })).toHaveFocus();

    const progress = screen.getByTestId("wizard-progress");
    const items = within(progress).getAllByRole("listitem");
    const [firstItem, secondItem, thirdItem] = items;

    expect(items).toHaveLength(3);

    if (!firstItem || !secondItem || !thirdItem) {
      throw new Error("expected three progress items");
    }

    expect(within(firstItem).getByText("Customer")).toBeDefined();
    // Current step container carries aria-current="step".
    expect(firstItem.querySelector("[aria-current='step']")).not.toBeNull();
    // The current step container is marked for assistive tech.
    expect(within(firstItem).getByText("1")).toBeDefined();

    act(() => {
      store.getState().setCustomer(customer);
    });
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Completed customer step becomes a jump-back button.
    const backToCustomer = screen.getByRole("button", {
      name: /customer.*completed/i,
    });
    await user.click(backToCustomer);

    expect(screen.getByRole("heading", { name: "Customer" })).toHaveFocus();
  });

  test("Next is gated until the step is valid and announces progress", async () => {
    const store = createOrderWizardStore();
    const user = userEvent.setup();

    render(<WizardShell store={store} />);

    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(nextButton).toBeDisabled();

    act(() => {
      store.getState().setCustomer(customer);
    });
    expect(nextButton).toBeEnabled();

    await user.click(nextButton);

    expect(store.getState().stepIndex).toBe(1);
    expect(screen.getByRole("status").textContent).toBe(
      "Step 2 of 3: Line items",
    );

    // Line-items step needs at least one line.
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    act(() => {
      store.getState().addProduct(product());
    });
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  test("Back steps backward, is disabled on the first step, and review hides Next", async () => {
    const store = createOrderWizardStore();
    const user = userEvent.setup();

    render(<WizardShell store={store} />);

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    act(() => {
      store.getState().setCustomer(customer);
    });
    await user.click(screen.getByRole("button", { name: "Next" }));
    act(() => {
      store.getState().addProduct(product());
    });
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("status").textContent).toBe("Step 3 of 3: Review");
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(store.getState().stepIndex).toBe(1);
  });
});
