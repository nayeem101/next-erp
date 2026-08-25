import { describe, expect, test } from "vitest";

import {
  MissingProductError,
  buildLineSnapshots,
  cancellationKindFor,
  canPerformAction,
  canTransition,
  canViewFinancials,
  computeOrderTotalCents,
  isTerminalStatus,
} from "./domain";

import type { OrderStatus } from "./domain";

const ALL_STATUSES: OrderStatus[] = [
  "draft",
  "confirmed",
  "fulfilled",
  "cancelled",
];

const DRILL_ID = "0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60";
const HOSE_ID = "1b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f61";

const masterByProductId = new Map(
  [
    {
      productId: DRILL_ID,
      sku: "SKU-A",
      name: "Drill",
      unitPriceCents: 1299n,
    },
    {
      productId: HOSE_ID,
      sku: "SKU-B",
      name: "Hose",
      unitPriceCents: 450n,
    },
  ].map((entry) => [entry.productId, entry]),
);

describe("buildLineSnapshots", () => {
  test("snapshots current sku, name, price, and exact line totals in order", () => {
    const snapshots = buildLineSnapshots(
      [
        { productId: DRILL_ID, quantity: 2 },
        { productId: HOSE_ID, quantity: 10 },
      ],
      masterByProductId,
    );

    expect(snapshots).toEqual([
      expect.objectContaining({
        productSku: "SKU-A",
        productName: "Drill",
        quantity: 2,
        unitPriceCents: 1299n,
        lineTotalCents: 2598n,
      }),
      expect.objectContaining({
        productSku: "SKU-B",
        productName: "Hose",
        quantity: 10,
        unitPriceCents: 450n,
        lineTotalCents: 4500n,
      }),
    ]);
  });

  test("handles large quantities without float drift", () => {
    const snapshots = buildLineSnapshots(
      [{ productId: DRILL_ID, quantity: 999_999 }],
      masterByProductId,
    );

    expect(snapshots[0]?.lineTotalCents).toBe(1299n * 999_999n);
  });

  test("throws a typed error for unknown products", () => {
    expect(() =>
      buildLineSnapshots(
        [{ productId: "9b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f99", quantity: 1 }],
        masterByProductId,
      ),
    ).toThrow(MissingProductError);
  });
});

describe("computeOrderTotalCents", () => {
  test("sums exact bigint line totals and handles empty inputs", () => {
    const total = computeOrderTotalCents([
      { quantity: 2, unitPriceCents: 1299n },
      { quantity: 10, unitPriceCents: 450n },
    ]);

    expect(total).toBe(7098n);
    expect(computeOrderTotalCents([])).toBe(0n);
  });

  test("never loses precision on huge totals", () => {
    const total = computeOrderTotalCents([
      { quantity: 1_000_000, unitPriceCents: 99_999_999_999n },
    ]);

    expect(total).toBe(99_999_999_999_000_000n);
  });
});

describe("lifecycle transitions", () => {
  test("allows exactly the PRD transition graph", () => {
    const allowed: [OrderStatus, OrderStatus][] = [
      ["draft", "confirmed"],
      ["draft", "cancelled"],
      ["confirmed", "fulfilled"],
      ["confirmed", "cancelled"],
    ];

    for (const [from, to] of allowed) {
      expect(canTransition(from, to)).toBe(true);
    }

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (!allowed.some(([f, t]) => f === from && t === to)) {
          expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
        }
      }
    }
  });

  test("marks fulfilled and cancelled terminal", () => {
    expect(isTerminalStatus("draft")).toBe(false);
    expect(isTerminalStatus("confirmed")).toBe(false);
    expect(isTerminalStatus("fulfilled")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
  });

  test("classifies cancellation side effects per status", () => {
    expect(cancellationKindFor("draft")).toBe("clean-draft");
    expect(cancellationKindFor("confirmed")).toBe("reverse-sale");
    expect(cancellationKindFor("fulfilled")).toBe("not-cancellable");
    expect(cancellationKindFor("cancelled")).toBe("not-cancellable");
  });
});

describe("role projection", () => {
  test("create/update/confirm/cancel are admin+sales only", () => {
    for (const action of [
      "createDraft",
      "updateDraft",
      "confirm",
      "cancel",
    ] as const) {
      expect(canPerformAction(action, ["admin"])).toBe(true);
      expect(canPerformAction(action, ["sales"])).toBe(true);
      expect(canPerformAction(action, ["inventory"])).toBe(false);
      expect(canPerformAction(action, [])).toBe(false);
    }
  });

  test("fulfill is admin+inventory, not sales", () => {
    expect(canPerformAction("fulfill", ["admin"])).toBe(true);
    expect(canPerformAction("fulfill", ["inventory"])).toBe(true);
    expect(canPerformAction("fulfill", ["sales"])).toBe(false);
    expect(canPerformAction("fulfill", [])).toBe(false);
  });

  test("financial visibility excludes inventory alone", () => {
    expect(canViewFinancials(["admin"])).toBe(true);
    expect(canViewFinancials(["sales"])).toBe(true);
    expect(canViewFinancials(["inventory"])).toBe(false);
    expect(canViewFinancials(["inventory", "sales"])).toBe(true);
    expect(canViewFinancials([])).toBe(false);
  });
});
