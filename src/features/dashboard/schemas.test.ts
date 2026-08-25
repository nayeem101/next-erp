import { describe, expect, test } from "vitest";

import {
  DEFAULT_DASHBOARD_RANGE,
  dashboardRangeHref,
  parseDashboardRange,
} from "./schemas";

describe("dashboard range parsing", () => {
  test("defaults when the parameter is missing", () => {
    expect(parseDashboardRange({})).toBe(DEFAULT_DASHBOARD_RANGE);
    expect(parseDashboardRange({ range: undefined })).toBe("30d");
    expect(parseDashboardRange({ other: "90d" })).toBe("30d");
  });

  test("accepts every documented option", () => {
    expect(parseDashboardRange({ range: "30d" })).toBe("30d");
    expect(parseDashboardRange({ range: "90d" })).toBe("90d");
    expect(parseDashboardRange({ range: "12m" })).toBe("12m");
  });

  test("degrades hostile values to the default", () => {
    for (const hostile of [
      "45x",
      "30",
      "../../etc/passwd",
      "30d; drop table ledger_entries",
      "",
    ]) {
      expect(parseDashboardRange({ range: hostile })).toBe("30d");
    }
  });

  test("uses the first value of a repeated parameter", () => {
    expect(parseDashboardRange({ range: ["12m", "90d"] })).toBe("12m");
  });
});

describe("canonical dashboard hrefs", () => {
  test("omits the default range for a clean canonical URL", () => {
    expect(dashboardRangeHref("30d")).toBe("/dashboard");
  });

  test("encodes non-default ranges", () => {
    expect(dashboardRangeHref("90d")).toBe("/dashboard?range=90d");
    expect(dashboardRangeHref("12m")).toBe("/dashboard?range=12m");
  });
});
