import { describe, expect, test } from "vitest";

import { canonicalSearchParams, listQueryHref } from "./canonical";

describe("canonicalSearchParams", () => {
  test("sorts keys alphabetically and serializes values", () => {
    const params = canonicalSearchParams({
      pageSize: 25,
      search: "ada",
      role: "sales",
      page: 2,
    });

    expect(params.toString()).toBe("page=2&pageSize=25&role=sales&search=ada");
  });

  test("drops undefined, null, and empty-string values", () => {
    const params = canonicalSearchParams({
      a: undefined,
      b: null,
      c: "",
      d: "kept",
    });

    expect(params.toString()).toBe("d=kept");
  });

  test("omits values equal to their defaults", () => {
    const params = canonicalSearchParams(
      { page: 1, pageSize: 20, role: "sales" },
      { page: 1, pageSize: 20 },
    );

    expect(params.toString()).toBe("role=sales");
  });

  test("keeps falsy-but-meaningful values like zero and false", () => {
    const params = canonicalSearchParams({ archived: false, depth: 0 }, {});

    expect(params.toString()).toBe("archived=false&depth=0");
  });
});

describe("listQueryHref", () => {
  test("merges patch over current with defaults omitted", () => {
    const href = listQueryHref(
      "/admin/users",
      { page: 3, pageSize: 20, role: "sales" },
      { page: 4 },
      { page: 1, pageSize: 20 },
    );

    expect(href).toBe("/admin/users?page=4&role=sales");
  });

  test("deletes keys patched with undefined", () => {
    const href = listQueryHref(
      "/inventory/products",
      { search: "bolt", page: 2 },
      { search: undefined, page: 1 },
      { page: 1 },
    );

    expect(href).toBe("/inventory/products");
  });

  test("returns the bare path when nothing survives", () => {
    const href = listQueryHref("/admin/users", {}, { search: "" }, {});

    expect(href).toBe("/admin/users");
  });

  test("output round-trips through URLSearchParams parsing", () => {
    const href = listQueryHref("/x", { b: "two", a: "one" }, { c: true });

    const params = new URLSearchParams(href.split("?")[1] ?? "");

    expect([...params.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(params.get("c")).toBe("true");
  });
});
