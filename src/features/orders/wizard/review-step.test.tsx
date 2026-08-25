import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import type { ActionResult } from "@/lib/errors/action-result";

import { ReviewStep } from "./review-step";
import { createOrderWizardStore } from "./store";

import type { ActiveProductOption } from "../selectors";

function product(
  overrides: Partial<ActiveProductOption> = {},
): ActiveProductOption {
  return {
    id: "p1",
    sku: "SKU-1",
    name: "Cordless Drill",
    unitPriceCents: 12999,
    stockOnHand: 50,
    ...overrides,
  };
}

const customer = {
  id: "c1",
  name: "Acme Retail",
  companyName: null,
  email: "buyer@acme.com",
  phone: null,
  city: "Springfield",
  region: null,
  countryCode: "US",
};

function seedWizard() {
  const store = createOrderWizardStore();
  store.getState().setCustomer(customer);
  store.getState().addProduct(product());
  store.getState().addProduct(
    product({
      id: "p2",
      sku: "SKU-2",
      name: "Garden Hose",
      unitPriceCents: 4550,
    }),
  );
  store.getState().updateQuantity(store.getState().lines[0]?.key ?? "", 2);

  return store;
}

describe("review step", () => {
  test("summarizes customer, lines, and exact estimated total", () => {
    const store = seedWizard();

    render(
      <ReviewStep
        store={store}
        onSave={() => Promise.resolve({ ok: true, data: undefined })}
      />,
    );

    expect(screen.getByText("Acme Retail")).toBeDefined();
    expect(screen.getByText("2 products")).toBeDefined();

    // 2 x 129.99 + 1 x 45.50 = 305.48
    expect(screen.getByText("$305.48")).toBeDefined();

    // Line rows render name, SKU, and quantity (text split across nodes).
    const linesList = screen.getByRole("list");
    expect(within(linesList).getByText(/Cordless Drill/)).not.toBeNull();
    expect(within(linesList).getAllByText(/×/)).toHaveLength(2);
  });

  test("notes edit flows into the store for the save payload", async () => {
    const store = seedWizard();
    const user = userEvent.setup();

    render(
      <ReviewStep
        store={store}
        onSave={() => Promise.resolve({ ok: true, data: undefined })}
      />,
    );

    const notes = screen.getByLabelText(/Notes for this order/);
    await user.type(notes, "Deliver to dock B");

    expect(store.getState().notes).toBe("Deliver to dock B");
  });

  test("successful save keeps the button busy during flight only", async () => {
    const store = seedWizard();
    const user = userEvent.setup();

    let resolveSave: (result: ActionResult<unknown>) => void = () => undefined;
    const onSave = () =>
      new Promise<ActionResult<unknown>>((resolve) => {
        resolveSave = resolve;
      });

    render(<ReviewStep store={store} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    // In-flight state is visible immediately.
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDefined();

    resolveSave({ ok: true, data: undefined });

    // Success leaves navigation to the page; no error alert appears.
    await screen.findByText("$305.48");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("failed saves surface the action error and keep every input", async () => {
    const store = seedWizard();
    const user = userEvent.setup();

    let rejectSave: (result: ActionResult<unknown>) => void = () => undefined;
    const onSave = () =>
      new Promise<ActionResult<unknown>>((resolve) => {
        rejectSave = resolve;
      });

    render(<ReviewStep store={store} onSave={onSave} />);

    await user.type(
      screen.getByLabelText(/Notes for this order/),
      "Keep this text",
    );
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    rejectSave({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "A product in this order was archived. Remove it first.",
      },
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "A product in this order was archived. Remove it first.",
    );

    // Error recovery: nothing was lost.
    expect(store.getState().customerId).toBe("c1");
    expect(store.getState().lines).toHaveLength(2);
    expect(store.getState().notes).toBe("Keep this text");
    expect(screen.getByLabelText(/Notes for this order/)).toHaveValue(
      "Keep this text",
    );

    // The wizard is interactive again for a retry.
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });

  test("thrown save errors degrade to a generic alert without losing input", async () => {
    const store = seedWizard();
    const user = userEvent.setup();

    const onSave = () => Promise.reject(new Error("network down"));

    render(<ReviewStep store={store} onSave={onSave} />);

    await user.type(screen.getByLabelText(/Notes for this order/), "x");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Something went wrong while saving");

    expect(store.getState().lines).toHaveLength(2);
  });
});
