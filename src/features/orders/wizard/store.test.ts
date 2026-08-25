import { describe, expect, test } from "vitest";

import { createOrderWizardStore, wizardTotalCents } from "./store";

import type { ActiveCustomerOption, ActiveProductOption } from "../selectors";
import type { WizardLine } from "./store";

function customer(
  overrides: Partial<ActiveCustomerOption> = {},
): ActiveCustomerOption {
  return {
    id: "c1",
    name: "Buyer Co",
    companyName: "Buyer Holdings",
    email: "buyer@example.com",
    phone: null,
    city: "Springfield",
    region: null,
    countryCode: "US",
    ...overrides,
  };
}

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

function line(overrides: Partial<WizardLine> = {}): WizardLine {
  return {
    key: "k1",
    productId: "p1",
    sku: "SKU-1",
    name: "Drill",
    unitPriceCents: 1299,
    quantity: 2,
    ...overrides,
  };
}

describe("order wizard store", () => {
  test("starts empty at the customer step", () => {
    const store = createOrderWizardStore();
    const state = store.getState();

    expect(state.stepIndex).toBe(0);
    expect(state.customerId).toBeNull();
    expect(state.lines).toEqual([]);
    expect(state.notes).toBe("");
  });

  test("setCustomer records identity and clearing it resets the choice", () => {
    const store = createOrderWizardStore();

    store.getState().setCustomer(customer({ id: "c9", name: "Acme" }));
    expect(store.getState().customerId).toBe("c9");
    expect(store.getState().customerName).toBe("Acme");

    store.getState().setCustomer(null);
    expect(store.getState().customerId).toBeNull();
    expect(store.getState().customerName).toBeNull();
  });

  test("addProduct creates one row per product and bumps duplicates", () => {
    const store = createOrderWizardStore();

    store.getState().addProduct(product());
    store.getState().addProduct(product({ id: "p2", sku: "SKU-2" }));
    store.getState().addProduct(product());

    const lines = store.getState().lines;

    expect(lines).toHaveLength(2);
    expect(lines[0]?.quantity).toBe(2);
    expect(lines.map((row) => row.productId)).toEqual(["p1", "p2"]);
  });

  test("updateQuantity clamps to [1, 1000000] and removeLine drops by key", () => {
    const store = createOrderWizardStore();

    store.getState().addProduct(product());
    const key = store.getState().lines[0]?.key;

    if (!key) {
      throw new Error("expected a seeded line");
    }

    store.getState().updateQuantity(key, 0);
    expect(store.getState().lines[0]?.quantity).toBe(1);

    store.getState().updateQuantity(key, 2_500_000);
    expect(store.getState().lines[0]?.quantity).toBe(1_000_000);

    store.getState().removeLine("missing-key");
    expect(store.getState().lines).toHaveLength(1);

    store.getState().removeLine(key);
    expect(store.getState().lines).toEqual([]);
  });

  test("goToStep gates forward movement on completed prerequisites", () => {
    const store = createOrderWizardStore();

    // No customer yet: cannot reach line items or review.
    expect(store.getState().goToStep(2)).toBe(false);
    expect(store.getState().stepIndex).toBe(0);

    store.getState().setCustomer(customer());
    expect(store.getState().goToStep(1)).toBe(true);

    // No lines yet: cannot reach review.
    expect(store.getState().goToStep(2)).toBe(false);
    expect(store.getState().stepIndex).toBe(1);

    store.getState().addProduct(product());
    expect(store.getState().next()).toBe(true);
    expect(store.getState().stepIndex).toBe(2);
  });

  test("back never leaves step zero and navigation is blocked while submitting", () => {
    const store = createOrderWizardStore();

    store.getState().setCustomer(customer());
    store.getState().addProduct(product());
    store.getState().next();
    store.getState().next();

    store.getState().setSubmitting(true);
    expect(store.getState().next()).toBe(false);
    expect(store.getState().goToStep(0)).toBe(false);
    store.getState().setSubmitting(false);

    store.getState().back();
    store.getState().back();
    store.getState().back();
    expect(store.getState().stepIndex).toBe(0);
  });

  test("hydrateDraft restores server draft under fresh client keys", () => {
    const store = createOrderWizardStore();

    store.getState().addProduct(product({ id: "stale", sku: "OLD" }));
    expect(store.getState().lines).not.toEqual([]);

    store.getState().hydrateDraft({
      customerId: "c5",
      customerName: "Hydrated Co",
      notes: "Leave at dock B",
      lines: [
        line({
          productId: "p7",
          sku: "SKU-7",
          unitPriceCents: 450,
          quantity: 3,
        }),
      ],
    });

    const state = store.getState();

    expect(state.stepIndex).toBe(0);
    expect(state.customerId).toBe("c5");
    expect(state.customerName).toBe("Hydrated Co");
    expect(state.notes).toBe("Leave at dock B");
    expect(state.submitting).toBe(false);
    expect(state.lines).toHaveLength(1);

    const hydrated = state.lines[0];

    if (!hydrated) {
      throw new Error("expected a hydrated line");
    }

    // Stale local rows are replaced, not merged.
    expect(hydrated.productId).toBe("p7");
    expect(hydrated.unitPriceCents).toBe(450);
    expect(hydrated.key).toBeTruthy();
  });

  test("reset returns the instance to its pristine shape", () => {
    const store = createOrderWizardStore();

    store.getState().setCustomer(customer());
    store.getState().addProduct(product());
    store.getState().setNotes("hello");
    store.getState().next();
    store.getState().next();

    store.getState().reset();

    expect(store.getState()).toMatchObject({
      stepIndex: 0,
      customerId: null,
      customerName: null,
      lines: [],
      notes: "",
      submitting: false,
    });
  });

  test("wizardTotalCents sums exact bigint line math", () => {
    expect(
      wizardTotalCents([
        line({ unitPriceCents: 1299, quantity: 3 }),
        line({ key: "k2", productId: "p2", unitPriceCents: 455, quantity: 2 }),
      ]),
    ).toBe(4807n);
    expect(wizardTotalCents([])).toBe(0n);
  });
});
