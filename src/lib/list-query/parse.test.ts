import { describe, expect, test } from "vitest";
import { z } from "zod";

import { parseListQuery } from "./parse";

const gridSchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(50)
      .optional()
      .transform((value) =>
        value !== undefined && value.length > 0 ? value : undefined,
      ),
    role: z.enum(["admin", "sales"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(5).max(100).default(20),
  })
  .strict();

describe("parseListQuery", () => {
  test("coerces and applies defaults from URLSearchParams", () => {
    const params = new URLSearchParams("page=3&pageSize=10&role=sales");

    const result = parseListQuery(params, gridSchema);

    expect(result).toEqual({
      recovered: false,
      query: { page: 3, pageSize: 10, role: "sales", search: undefined },
    });
  });

  test("keeps the last value when a key repeats", () => {
    const params = new URLSearchParams("role=admin&role=sales");

    const result = parseListQuery(params, gridSchema);

    expect(result.query.role).toBe("sales");
    expect(result.recovered).toBe(false);
  });

  test("reads Next.js style records with array values", () => {
    const result = parseListQuery(
      { page: ["2"], search: ["  ada  "], extra: ["ignored"] },
      gridSchema,
    );

    expect(result.query.page).toBe(2);
    expect(result.query.search).toBe("ada");
    expect(result.recovered).toBe(false);
  });

  test("recovers by dropping invalid keys while keeping valid ones", () => {
    const params = new URLSearchParams(
      "page=not-a-number&pageSize=9999&role=root&search=ok",
    );

    const result = parseListQuery(params, gridSchema);

    expect(result.recovered).toBe(true);
    // pageSize/role invalid -> defaults; search survived; page defaulted.
    expect(result.query).toEqual({
      page: 1,
      pageSize: 20,
      role: undefined,
      search: "ok",
    });
  });

  test("keeps individually valid keys when another key fails", () => {
    const params = new URLSearchParams("page=4&pageSize=25&role=sales&junk=x");

    const result = parseListQuery(params, gridSchema);

    expect(result.recovered).toBe(false);
    expect(result.query.page).toBe(4);
    expect(result.query.pageSize).toBe(25);
  });

  test("empty input parses to pure defaults without recovery", () => {
    const result = parseListQuery(new URLSearchParams(), gridSchema);

    expect(result.recovered).toBe(false);
    expect(result.query.page).toBe(1);
    expect(result.query.pageSize).toBe(20);
  });
});
