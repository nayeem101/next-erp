import { describe, expect, test } from "vitest";

import {
  cancelOrderSchema,
  createDraftOrderSchema,
  listOrdersQuerySchema,
  transitionOrderSchema,
  updateDraftOrderSchema,
} from "./schemas";

const productA = "0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60";
const productB = "1b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f61";

const validCreate = {
  customerId: "2b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f62",
  lines: [
    { productId: productA, quantity: 2 },
    { productId: productB, quantity: 10 },
  ],
  notes: undefined,
};

describe("orderLineInputSchema", () => {
  test("requires a positive whole quantity within bounds", () => {
    for (const quantity of [0, -1, 1.5, "abc", "", 1_000_001]) {
      expect(
        createDraftOrderSchema.safeParse({
          ...validCreate,
          lines: [{ productId: productA, quantity }],
        }).success,
      ).toBe(false);
    }

    expect(
      createDraftOrderSchema.safeParse({
        ...validCreate,
        lines: [{ productId: productA, quantity: 1_000_000 }],
      }).success,
    ).toBe(true);
  });

  test("coerces numeric strings from client inputs", () => {
    const result = createDraftOrderSchema.parse({
      ...validCreate,
      lines: [{ productId: productA, quantity: "7" }],
    });

    expect(result.lines[0]?.quantity).toBe(7);
  });
});

describe("createDraftOrderSchema", () => {
  test("accepts a full draft payload", () => {
    const result = createDraftOrderSchema.parse(validCreate);

    expect(result.customerId).toBe(validCreate.customerId);
    expect(result.lines).toHaveLength(2);
    expect(result.notes).toBeUndefined();
  });

  test("rejects empty line arrays", () => {
    expect(
      createDraftOrderSchema.safeParse({ ...validCreate, lines: [] }).success,
    ).toBe(false);
  });

  test("rejects more than one hundred lines", () => {
    const lines = Array.from({ length: 101 }, (_, index) => ({
      productId:
        index === 0
          ? productA
          : `${String(index).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`,
      quantity: 1,
    }));

    expect(
      createDraftOrderSchema.safeParse({ ...validCreate, lines }).success,
    ).toBe(false);
  });

  test("adds an issue on lines when the same product repeats", () => {
    const result = createDraftOrderSchema.safeParse({
      ...validCreate,
      lines: [
        { productId: productA, quantity: 1 },
        { productId: productB, quantity: 2 },
        { productId: productA, quantity: 3 },
      ],
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      const lineIssues = result.error.issues.filter(
        (issue) => issue.path[0] === "lines",
      );

      expect(lineIssues).toHaveLength(1);
      expect(lineIssues[0]?.message).toMatch(/only one line/i);
    }
  });

  test("maps blank notes to undefined and rejects unknown keys", () => {
    const blank = createDraftOrderSchema.parse({ ...validCreate, notes: "  " });
    expect(blank.notes).toBeUndefined();

    expect(
      createDraftOrderSchema.safeParse({ ...validCreate, extra: true }).success,
    ).toBe(false);
  });

  test("never accepts price or status fields from clients", () => {
    expect(
      createDraftOrderSchema.safeParse({
        ...validCreate,
        totalCents: 999,
      }).success,
    ).toBe(false);
    expect(
      createDraftOrderSchema.safeParse({
        ...validCreate,
        lines: [{ productId: productA, quantity: 1, unitPriceCents: 500 }],
      }).success,
    ).toBe(false);
  });
});

describe("updateDraftOrderSchema", () => {
  test("requires orderId and positive version alongside draft fields", () => {
    const result = updateDraftOrderSchema.parse({
      orderId: validCreate.customerId,
      version: 3,
      ...validCreate,
    });

    expect(result.version).toBe(3);
    expect(result.lines).toHaveLength(2);
  });

  test("rejects zero, negative, fractional, or missing versions", () => {
    for (const version of [0, -2, 1.5, "nope"]) {
      expect(
        updateDraftOrderSchema.safeParse({ ...validCreate, version }).success,
      ).toBe(false);
    }
  });

  test("enforces unique products on update too", () => {
    const result = updateDraftOrderSchema.safeParse({
      orderId: validCreate.customerId,
      version: 1,
      ...validCreate,
      lines: [
        { productId: productA, quantity: 1 },
        { productId: productA, quantity: 2 },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("transitionOrderSchema", () => {
  test("accepts orderId with a coerced positive version", () => {
    const result = transitionOrderSchema.parse({
      orderId: validCreate.customerId,
      version: "4",
    });

    expect(result.version).toBe(4);
  });

  test("rejects malformed ids and versions", () => {
    expect(
      transitionOrderSchema.safeParse({ orderId: "nope", version: 1 }).success,
    ).toBe(false);
    expect(
      transitionOrderSchema.safeParse({
        orderId: validCreate.customerId,
        version: 0,
      }).success,
    ).toBe(false);
  });
});

describe("cancelOrderSchema", () => {
  test("requires a non-empty reason up to five hundred chars", () => {
    expect(
      cancelOrderSchema.parse({
        orderId: validCreate.customerId,
        version: 2,
        reason: " Customer changed their mind. ",
      }).reason,
    ).toBe("Customer changed their mind.");

    for (const reason of ["", "   ", "x".repeat(501)]) {
      expect(
        cancelOrderSchema.safeParse({
          orderId: validCreate.customerId,
          version: 2,
          reason,
        }).success,
      ).toBe(false);
    }
  });
});

describe("listOrdersQuerySchema", () => {
  test("applies defaults", () => {
    const result = listOrdersQuerySchema.parse({});

    expect(result.status).toBe("all");
    expect(result.sort).toBe("newest");
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  test("coerces page strings and validates ISO date bounds", () => {
    const result = listOrdersQuerySchema.parse({
      page: "2",
      dateFrom: "2026-01-01",
      dateTo: "2026-08-25",
    });

    expect(result.page).toBe(2);
    expect(result.dateFrom).toBe("2026-01-01");
    expect(result.dateTo).toBe("2026-08-25");

    expect(
      listOrdersQuerySchema.safeParse({ dateFrom: "08/01/2026" }).success,
    ).toBe(false);
  });

  test("rejects invalid status and sort values", () => {
    expect(listOrdersQuerySchema.safeParse({ status: "shipped" }).success).toBe(
      false,
    );
    expect(listOrdersQuerySchema.safeParse({ sort: "magic" }).success).toBe(
      false,
    );
  });
});
