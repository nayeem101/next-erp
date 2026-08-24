import { describe, expect, test } from "vitest";

import {
  createCustomerSchema,
  listCustomersQuerySchema,
  setCustomerActiveSchema,
  updateCustomerSchema,
} from "./schemas";

const validCreate = {
  name: "  Acme Retail  ",
  email: "  Buyer@ACME.com ",
  phone: " +1 555-0100 ",
  companyName: " Acme Corp ",
  addressLine1: " 1 Main St ",
  addressLine2: " Suite 5 ",
  city: " Springfield ",
  region: " IL ",
  postalCode: " 62704 ",
  countryCode: " us ",
  notes: " Preferred buyer. ",
};

describe("email normalization", () => {
  test("trims and lowercases before persistence", () => {
    const result = createCustomerSchema.parse(validCreate);

    expect(result.email).toBe("buyer@acme.com");
  });

  test("treats case variants as the same identity", () => {
    const a = createCustomerSchema.parse({ ...validCreate, email: "A@B.co" });
    const b = createCustomerSchema.parse({ ...validCreate, email: "a@b.CO" });

    expect(a.email).toBe(b.email);
  });

  test("rejects malformed and oversized emails", () => {
    for (const email of [
      "not-an-email",
      "@x.com",
      "a b@c.com",
      `${"a".repeat(320)}@x.co`,
      "",
    ]) {
      expect(
        createCustomerSchema.safeParse({ ...validCreate, email }).success,
      ).toBe(false);
    }
  });
});

describe("country code normalization", () => {
  test("uppercases the two-letter code", () => {
    const result = createCustomerSchema.parse(validCreate);

    expect(result.countryCode).toBe("US");
  });

  test("rejects wrong lengths", () => {
    for (const countryCode of ["U", "USA", ""]) {
      expect(
        createCustomerSchema.safeParse({ ...validCreate, countryCode }).success,
      ).toBe(false);
    }
  });
});

describe("createCustomerSchema", () => {
  test("trims required and optional text fields", () => {
    const result = createCustomerSchema.parse(validCreate);

    expect(result.name).toBe("Acme Retail");
    expect(result.phone).toBe("+1 555-0100");
    expect(result.notes).toBe("Preferred buyer.");
  });

  test("maps blank optional fields to undefined", () => {
    const result = createCustomerSchema.parse({
      ...validCreate,
      phone: "   ",
      addressLine2: "",
      region: undefined,
      companyName: undefined,
      notes: "",
    });

    expect(result.phone).toBeUndefined();
    expect(result.addressLine2).toBeUndefined();
    expect(result.region).toBeUndefined();
    expect(result.companyName).toBeUndefined();
    expect(result.notes).toBeUndefined();
  });

  test("requires every mandatory field", () => {
    for (const key of [
      "name",
      "email",
      "addressLine1",
      "city",
      "postalCode",
      "countryCode",
    ] as const) {
      const payload = { ...validCreate };
      payload[key] = undefined;

      expect(createCustomerSchema.safeParse(payload).success).toBe(false);
    }
  });

  test("enforces length ceilings on text fields", () => {
    expect(
      createCustomerSchema.safeParse({ ...validCreate, name: "x".repeat(161) })
        .success,
    ).toBe(false);
    expect(
      createCustomerSchema.safeParse({ ...validCreate, name: "x".repeat(160) })
        .success,
    ).toBe(true);
    expect(
      createCustomerSchema.safeParse({
        ...validCreate,
        postalCode: "x".repeat(25),
      }).success,
    ).toBe(false);
  });

  test("rejects unknown keys", () => {
    expect(
      createCustomerSchema.safeParse({ ...validCreate, extra: true }).success,
    ).toBe(false);
  });
});

describe("updateCustomerSchema", () => {
  test("accepts a valid payload with customerId", () => {
    const result = updateCustomerSchema.parse({
      customerId: "0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60",
      ...validCreate,
    });

    expect(result.customerId).toBe("0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60");
    expect(result.email).toBe("buyer@acme.com");
  });

  test("rejects non-uuid identifiers", () => {
    expect(
      updateCustomerSchema.safeParse({
        customerId: "nope",
        ...validCreate,
      }).success,
    ).toBe(false);
  });
});

describe("setCustomerActiveSchema", () => {
  test("accepts archive and restore payloads", () => {
    expect(
      setCustomerActiveSchema.parse({
        customerId: "0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60",
        isActive: false,
      }).isActive,
    ).toBe(false);
  });

  test("rejects missing or non-boolean flags", () => {
    expect(
      setCustomerActiveSchema.safeParse({
        customerId: "0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60",
      }).success,
    ).toBe(false);
    expect(
      setCustomerActiveSchema.safeParse({
        customerId: "0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60",
        isActive: "yes",
      }).success,
    ).toBe(false);
  });
});

describe("listCustomersQuerySchema", () => {
  test("applies defaults", () => {
    const result = listCustomersQuerySchema.parse({});

    expect(result.status).toBe("all");
    expect(result.sort).toBe("name");
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.search).toBeUndefined();
  });

  test("coerces numeric strings from URLs and drops empty search", () => {
    const result = listCustomersQuerySchema.parse({
      page: "3",
      pageSize: "50",
      search: "   ",
      status: "archived",
      sort: "email_desc",
    });

    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
    expect(result.search).toBeUndefined();
    expect(result.status).toBe("archived");
  });

  test("rejects invalid status, sort, and ranges", () => {
    for (const patch of [
      { status: "pending" },
      { sort: "weird" },
      { page: 0 },
      { pageSize: 101 },
    ]) {
      expect(listCustomersQuerySchema.safeParse(patch).success).toBe(false);
    }
  });
});
