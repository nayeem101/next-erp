import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { UserMenu } from "@/components/shared/user-menu";

vi.mock("@/features/auth/actions", () => ({
  signOut: vi.fn(),
}));

/**
 * Base UI menus ignore synthetic pointer events (`isTrusted: false`), so the
 * opened-menu flow (identity display + sign-out call) is covered by the
 * Playwright authentication suite instead of RTL.
 */
describe("UserMenu", () => {
  test("shows initials derived from the display name", () => {
    render(<UserMenu displayName="Ada Lovelace" email="ada@example.com" />);

    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  test("falls back to a generic initial for single-word names", () => {
    render(<UserMenu displayName="admin" email="admin@example.com" />);

    expect(screen.getByText("A")).toBeInTheDocument();
  });

  test("exposes an accessible account-menu trigger", () => {
    render(<UserMenu displayName="Ada Lovelace" email="ada@example.com" />);

    const trigger = screen.getByRole("button", {
      name: /account menu for ada lovelace/i,
    });

    expect(trigger).toBeInTheDocument();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });
});
