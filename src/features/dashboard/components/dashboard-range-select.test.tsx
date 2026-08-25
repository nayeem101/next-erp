import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { DashboardRangeSelect } from "./dashboard-range-select";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

describe("dashboard range select", () => {
  beforeEach(() => {
    mocks.push.mockClear();
  });

  test("marks the current range and offers all documented options", () => {
    render(<DashboardRangeSelect value="30d" />);

    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    for (const label of ["30 days", "90 days", "12 months"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  test("navigates to canonical hrefs for non-default ranges", async () => {
    const user = userEvent.setup();

    render(<DashboardRangeSelect value="30d" />);

    await user.click(screen.getByRole("button", { name: "12 months" }));

    expect(mocks.push).toHaveBeenCalledWith("/dashboard?range=12m");

    await user.click(screen.getByRole("button", { name: "90 days" }));

    expect(mocks.push).toHaveBeenCalledWith("/dashboard?range=90d");
  });

  test("selecting the default range strips the parameter", async () => {
    const user = userEvent.setup();

    render(<DashboardRangeSelect value="12m" />);

    await user.click(screen.getByRole("button", { name: "30 days" }));

    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  });
});
