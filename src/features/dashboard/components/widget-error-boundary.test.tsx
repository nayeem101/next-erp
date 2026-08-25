import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { WidgetErrorBoundary } from "./widget-error-boundary";

function GoodChild(): string {
  return "sibling-content";
}

function BadChild(): never {
  throw new Error("widget exploded");
}

describe("widget error boundary", () => {
  test("a failing widget does not block its sibling", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      render(
        <div>
          <WidgetErrorBoundary title="Broken widget">
            <BadChild />
          </WidgetErrorBoundary>
          <WidgetErrorBoundary title="Healthy widget">
            <GoodChild />
          </WidgetErrorBoundary>
        </div>,
      );

      // The broken widget shows a local alert with retry…
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Broken widget could not load.",
      );
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

      // …while the healthy sibling still renders its content.
      expect(screen.getByText("sibling-content")).toBeInTheDocument();
      expect(screen.queryByText(/Healthy widget could not/)).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
