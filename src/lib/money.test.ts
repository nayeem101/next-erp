import { describe, expect, test } from "vitest";

import {
  centsToMoneyString,
  formatCentsAsMoneyString,
  MAX_MONEY_CENTS,
  moneyStringToCents,
  parseMoneyToCents,
} from "@/lib/money";

describe("parseMoneyToCents", () => {
  test.each([
    ["0", 0n],
    ["0.05", 5n],
    ["1.5", 150n],
    ["12.34", 1234n],
    ["99,999".replace(/,/g, ""), 9999900n],
    ["99999999999.99", MAX_MONEY_CENTS],
    ["007", null],
    ["01.00", null],
  ])("parses %s to %s", (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });

  test("rejects values that would require rounding", () => {
    for (const input of ["1.005", "0.001", "10.555"]) {
      expect(parseMoneyToCents(input)).toBeNull();
    }
  });

  test("rejects malformed inputs", () => {
    for (const input of [
      "",
      "   ",
      ".50",
      "1.",
      "-5.00",
      "+5.00",
      "1,234.56",
      "$5.00",
      "abc",
      "12.3a",
      "NaN",
      "Infinity",
    ]) {
      expect(parseMoneyToCents(input)).toBeNull();
    }
  });

  test("accepts the boundary maximum and rejects beyond it", () => {
    expect(parseMoneyToCents("99999999999.99")).toBe(MAX_MONEY_CENTS);
    expect(parseMoneyToCents("100000000000")).toBeNull();
  });

  test("is exact across the full range without float drift", () => {
    for (let cents = 0n; cents < 300n; cents += 7n) {
      const serialized = formatCentsAsMoneyString(cents);

      expect(parseMoneyToCents(serialized)).toBe(cents);
    }
  });
});

describe("formatCentsAsMoneyString", () => {
  test("renders canonical decimal strings", () => {
    expect(formatCentsAsMoneyString(0n)).toBe("0.00");
    expect(formatCentsAsMoneyString(5n)).toBe("0.05");
    expect(formatCentsAsMoneyString(1234n)).toBe("12.34");
    expect(formatCentsAsMoneyString(MAX_MONEY_CENTS)).toBe("99999999999.99");
  });

  test("handles negative defensively", () => {
    expect(formatCentsAsMoneyString(-1234n)).toBe("-12.34");
    expect(formatCentsAsMoneyString(-5n)).toBe("-0.05");
  });

  test("round-trips through parse and serialization helpers", () => {
    const cents = 43219876n;
    const money = formatCentsAsMoneyString(cents);

    expect(money).toBe("432198.76");
    expect(parseMoneyToCents(money)).toBe(cents);
  });
});

describe("bigint serialization bridge", () => {
  test("converts between database and wire representations", () => {
    const wire = centsToMoneyString(125099n);

    expect(wire).toBe("125099");
    expect(moneyStringToCents(wire)).toBe(125099n);
    expect(moneyStringToCents("not-a-number")).toBeNull();
    expect(moneyStringToCents("12.34")).toBeNull();
  });
});
