import { describe, expect, test } from "vitest";

import {
  createCategorySchema,
  listCategoriesQuerySchema,
  setCategoryActiveSchema,
  slugify,
  updateCategorySchema,
} from "./schemas";

describe("slugify", () => {
  test("lowercases and dashes ordinary names", () => {
    expect(slugify("Power Tools")).toBe("power-tools");
    expect(slugify("Hand Tools & Accessories")).toBe(
      "hand-tools-and-accessories",
    );
  });

  test("is deterministic for equivalent inputs", () => {
    const variants = [
      "Power Tools",
      " power  tools ",
      "POWER TOOLS",
      "power--tools",
    ];

    const slugs = variants.map(slugify);

    expect(new Set(slugs).size).toBe(1);
    expect(slugs[0]).toBe("power-tools");
  });

  test("transliterates accents and strips symbols", () => {
    expect(slugify("Café & Crémier #2")).toBe("cafe-and-cremier-2");
    expect(slugify("Öle/Schmiere")).toBe("ole-schmiere");
  });

  test("never produces empty or boundary-dashed slugs for wordy input", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("--a--").startsWith("-")).toBe(false);
    expect(slugify("--a--").endsWith("-")).toBe(false);
  });
});

describe("createCategorySchema", () => {
  test("accepts a valid payload and trims text", () => {
    const result = createCategorySchema.parse({
      name: "  Power Tools  ",
      description: "  Everything with a plug. ",
    });

    expect(result.name).toBe("Power Tools");
    expect(result.description).toBe("Everything with a plug.");
  });

  test("collapses blank description to undefined", () => {
    const result = createCategorySchema.parse({
      name: "Power Tools",
      description: "   ",
    });

    expect(result.description).toBeUndefined();
  });

  test("rejects missing/oversized name and unknown keys", () => {
    expect(createCategorySchema.safeParse({}).success).toBe(false);
    expect(
      createCategorySchema.safeParse({ name: "x".repeat(101) }).success,
    ).toBe(false);
    expect(
      createCategorySchema.safeParse({ name: "Tools", extra: true }).success,
    ).toBe(false);
    expect(
      createCategorySchema.safeParse({ name: "x".repeat(100) }).success,
    ).toBe(true);
  });

  test("description over the cap fails even when trimmed shorter is fine", () => {
    expect(
      createCategorySchema.safeParse({
        name: "Tools",
        description: "d".repeat(1001),
      }).success,
    ).toBe(false);
    expect(
      createCategorySchema.safeParse({
        name: "Tools",
        description: "d".repeat(1000),
      }).success,
    ).toBe(true);
  });
});

describe("updateCategorySchema and setCategoryActiveSchema shapes", () => {
  test("update shares field constraints with create plus a category id", () => {
    const categoryId = "0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60";
    const base = { categoryId, name: "Fasteners", description: "" };

    const result = updateCategorySchema.parse(base);

    expect(result.categoryId).toBe(categoryId);
    // Duplicate-shape guarantee: identical body minus id parses as create.
    expect(() =>
      createCategorySchema.parse({
        name: base.name,
        description: base.description,
      }),
    ).not.toThrow();
    expect(
      updateCategorySchema.safeParse({ ...base, categoryId: "nope" }).success,
    ).toBe(false);
  });

  test("setCategoryActive requires an explicit boolean", () => {
    const categoryId = "0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60";

    expect(
      setCategoryActiveSchema.safeParse({ categoryId, isActive: false })
        .success,
    ).toBe(true);
    expect(
      setCategoryActiveSchema.safeParse({ categoryId, isActive: "false" })
        .success,
    ).toBe(false);
    expect(setCategoryActiveSchema.safeParse({ categoryId }).success).toBe(
      false,
    );
  });
});

describe("listCategoriesQuerySchema", () => {
  test("defaults to active-only, name-sorted first page", () => {
    const result = listCategoriesQuerySchema.parse({ search: undefined });

    expect(result).toEqual({
      search: undefined,
      status: "active",
      sort: "name",
      page: 1,
      pageSize: 20,
    });
  });

  test("coerces URL params and restricts sort to the allowlist", () => {
    const result = listCategoriesQuerySchema.parse({
      page: "2",
      pageSize: "50",
      status: "archived",
      sort: "most_products",
    });

    expect(result.page).toBe(2);
    expect(result.sort).toBe("most_products");
    expect(
      listCategoriesQuerySchema.safeParse({ sort: "cheapest" }).success,
    ).toBe(false);
    expect(
      listCategoriesQuerySchema.safeParse({ status: "hidden" }).success,
    ).toBe(false);
  });
});
