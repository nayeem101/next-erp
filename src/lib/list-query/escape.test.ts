import { describe, expect, test } from "vitest";

import {
  escapeLikePattern,
  ilikeContainsPattern,
  ilikeStartsWithPattern,
} from "./escape";

describe("escapeLikePattern", () => {
  test("escapes percent, underscore, and backslash", () => {
    expect(escapeLikePattern("50%_off\\path")).toBe("50\\%\\_off\\\\path");
  });

  test("leaves ordinary text untouched", () => {
    expect(escapeLikePattern("Ada.Admin-2026@example.com")).toBe(
      "Ada.Admin-2026@example.com",
    );
  });
});

describe("ilikeContainsPattern", () => {
  test("wraps escaped input in wildcards", () => {
    expect(ilikeContainsPattern("fifty%off")).toBe("%fifty\\%off%");
  });
});

describe("ilikeStartsWithPattern", () => {
  test("anchors the wildcard to the tail only", () => {
    expect(ilikeStartsWithPattern("ada_admin")).toBe("ada\\_admin%");
  });
});
