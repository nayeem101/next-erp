import { describe, expect, test } from "vitest";

import {
  adjustStockSchema,
  createProductSchema,
  listProductsQuerySchema,
  setProductActiveSchema,
  updateProductSchema,
} from "./schemas";

const categoryId = "0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60";

const validCreate = {
  categoryId,
  sku: " sku-001 ",
  name: "Cordless Drill",
  unitPrice: "89.99",
  reorderLevel: 10,
  openingStock: 25,
};

describe("SKU normalization", () => {
  test("uppercases and trims before persistence", () => {
    const result = createProductSchema.parse(validCreate);

    expect(result.sku).toBe("SKU-001");
  });

  test("treats case variants as the same normalized identity", () => {
    const a = createProductSchema.parse({ ...validCreate, sku: "abc-123" });
    const b = createProductSchema.parse({ ...validCreate, sku: "ABC-123" });

    expect(a.sku).toBe(b.sku);
  });
});

describe("createProductSchema", () => {
  test("accepts a full valid payload", () => {
    const result = createProductSchema.parse(validCreate);

    expect(result.openingStock).toBe(25);
    expect(result.unitPrice).toBe("89.99");
  });

  test("rejects zero, negative, and over-precision money", () => {
    for (const unitPrice of ["0", "-5.00", "1.999", "abc", ""]) {
      expect(
        createProductSchema.safeParse({ ...validCreate, unitPrice }).success,
      ).toBe(false);
    }

    expect(
      createProductSchema.safeParse({ ...validCreate, unitPrice: "0.01" })
        .success,
    ).toBe(true);
  });

  test("rejects negative quantities and non-integer stock", () => {
    expect(
      createProductSchema.safeParse({ ...validCreate, reorderLevel: -1 })
        .success,
    ).toBe(false);
    expect(
      createProductSchema.safeParse({ ...validCreate, openingStock: 2.5 })
        .success,
    ).toBe(false);
    expect(
      createProductSchema.safeParse({ ...validCreate, openingStock: "7" })
        .success,
    ).toBe(true);
  });

  test("enforces strict keys and required fields", () => {
    expect(
      createProductSchema.safeParse({ ...validCreate, extra: 1 }).success,
    ).toBe(false);
    expect(
      createProductSchema.safeParse({ ...validCreate, categoryId: "nope" })
        .success,
    ).toBe(false);
  });
});

describe("updateProductSchema and setProductActiveSchema shapes", () => {
  test("update shares field contracts with create plus product id", () => {
    const productId = "7c1e2682-1a1f-4d3e-9a4b-2f5b6c7d8e9f";

    const { openingStock: _opening, ...updateFields } = validCreate;
    void _opening;

    const result = updateProductSchema.parse({
      productId,
      ...updateFields,
    });

    expect(result.productId).toBe(productId);
    // No openingStock on updates: stock moves only via adjustments.
    expect(updateProductSchema.safeParse({ ...validCreate }).success).toBe(
      false,
    );
  });

  test("setProductActive requires explicit boolean", () => {
    const productId = validCreate.categoryId;

    expect(
      setProductActiveSchema.safeParse({ productId, isActive: true }).success,
    ).toBe(true);
    expect(setProductActiveSchema.safeParse({ productId }).success).toBe(false);
  });
});

describe("adjustStockSchema", () => {
  test("accepts positive and negative deltas with a reason", () => {
    const base = { productId: validCreate.categoryId };

    expect(
      adjustStockSchema.safeParse({
        ...base,
        quantityDelta: -3,
        reason: "Damaged in transit",
      }).success,
    ).toBe(true);
    expect(
      adjustStockSchema.safeParse({
        ...base,
        quantityDelta: 5,
        reason: "Cycle count",
      }).success,
    ).toBe(true);
  });

  test("rejects zero deltas, blank reasons, and out-of-range magnitudes", () => {
    const base = { productId: validCreate.categoryId, reason: "Count" };

    expect(
      adjustStockSchema.safeParse({ ...base, quantityDelta: 0 }).success,
    ).toBe(false);
    expect(
      adjustStockSchema.safeParse({ ...base, quantityDelta: 1, reason: "   " })
        .success,
    ).toBe(false);
    expect(
      adjustStockSchema.safeParse({ ...base, quantityDelta: 1_000_001 })
        .success,
    ).toBe(false);
  });
});

describe("listProductsQuerySchema", () => {
  test("defaults to active products sorted by name", () => {
    const result = listProductsQuerySchema.parse({});

    expect(result).toEqual({
      search: undefined,
      categoryId: undefined,
      stockStatus: "active",
      sort: "name",
      page: 1,
      pageSize: 20,
    });
  });

  test("coerces params and enforces allowlists", () => {
    const result = listProductsQuerySchema.parse({
      search: "drill",
      categoryId,
      stockStatus: "low_stock",
      sort: "price_desc",
      page: "3",
      pageSize: "50",
    });

    expect(result.page).toBe(3);
    expect(result.sort).toBe("price_desc");

    expect(listProductsQuerySchema.safeParse({ sort: "random" }).success).toBe(
      false,
    );
    expect(
      listProductsQuerySchema.safeParse({ stockStatus: "missing" }).success,
    ).toBe(false);
  });
});
