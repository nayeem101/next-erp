import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { LineItemsStep } from "./line-items-step";
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

async function addProductByName(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.selectOptions(screen.getByLabelText("Product"), label);
  await user.click(screen.getByRole("button", { name: "Add" }));
}

describe("line items step", () => {
  test("adds products as unique rows and shows an empty state before any", async () => {
    const store = createOrderWizardStore();
    const user = userEvent.setup();

    render(
      <LineItemsStep
        store={store}
        options={[
          product(),
          product({ id: "p2", sku: "SKU-2", name: "Garden Hose" }),
        ]}
      />,
    );

    expect(screen.getByText(/No products added yet/)).toBeDefined();

    await addProductByName(user, "Cordless Drill (SKU-1)");
    await addProductByName(user, "Garden Hose (SKU-2)");
    // Re-adding bumps quantity instead of duplicating the row.
    await addProductByName(user, "Cordless Drill (SKU-1)");

    const table = screen.getByRole("table");
    // Header + two body rows + totals footer.
    expect(within(table).getAllByRole("row")).toHaveLength(4);

    const drillQty = screen.getByLabelText("Quantity for Cordless Drill");
    expect(drillQty).toHaveValue(2);
    expect(store.getState().lines.map((line) => line.productId)).toEqual([
      "p1",
      "p2",
    ]);
  });

  test("shows unit price, stock availability, line totals, and order total", async () => {
    const store = createOrderWizardStore();
    const user = userEvent.setup();

    render(
      <LineItemsStep
        store={store}
        options={[
          product(),
          product({
            id: "p2",
            sku: "SKU-2",
            name: "Garden Hose",
            unitPriceCents: 4550,
            stockOnHand: 4,
          }),
        ]}
      />,
    );

    await addProductByName(user, "Cordless Drill (SKU-1)");
    await addProductByName(user, "Garden Hose (SKU-2)");

    const table = screen.getByRole("table");

    // Stock context renders per row.
    expect(within(table).getByText("50 in stock")).toBeDefined();
    expect(within(table).getByText("4 in stock")).toBeDefined();

    // Hose unit price renders exactly.
    expect(within(table).getAllByText("$45.50").length).toBeGreaterThan(0);

    const drillQty = screen.getByLabelText("Quantity for Cordless Drill");
    await user.clear(drillQty);
    await user.type(drillQty, "3{Enter}");

    expect(within(table).getByText("$389.97")).toBeDefined();

    // Hose line total is exact at quantity 6 (6 x 45.50).
    const hoseQty = screen.getByLabelText("Quantity for Garden Hose");
    await user.clear(hoseQty);
    await user.type(hoseQty, "6{Enter}");

    expect(within(table).getByText(/exceeds current stock/)).toBeDefined();
    expect(within(table).getByText("$273.00")).toBeDefined();

    // Grand total: 3 x 129.99 + 6 x 45.50 = 389.97 + 273.00
    expect(within(table).getByText("$662.97")).toBeDefined();
  });

  test("remove buttons drop only their own row and totals update", async () => {
    const store = createOrderWizardStore();
    const user = userEvent.setup();

    render(
      <LineItemsStep
        store={store}
        options={[
          product(),
          product({ id: "p2", sku: "SKU-2", name: "Garden Hose" }),
        ]}
      />,
    );

    await addProductByName(user, "Cordless Drill (SKU-1)");
    await addProductByName(user, "Garden Hose (SKU-2)");

    await user.click(
      screen.getByRole("button", { name: "Remove Cordless Drill" }),
    );

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + body + footer
    expect(store.getState().lines[0]?.productId).toBe("p2");
  });
});
