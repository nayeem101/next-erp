import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import type { ActionError } from "@/lib/errors/action-result";

describe("ActionErrorAlert", () => {
  test("announces the failure message via alert role", () => {
    const error: ActionError = {
      code: "CONFLICT",
      message: "The order changed while you were editing. Reload to continue.",
    };

    render(<ActionErrorAlert error={error} />);

    const alert = screen.getByRole("alert");

    expect(alert).toHaveTextContent(
      "The order changed while you were editing. Reload to continue.",
    );
  });

  test("lists field-level errors when provided", () => {
    const error: ActionError = {
      code: "VALIDATION_ERROR",
      message: "Please review the highlighted fields.",
      fieldErrors: {
        sku: ["SKU is required", "SKU must be unique"],
      },
    };

    render(<ActionErrorAlert error={error} />);

    expect(screen.getByText("SKU is required")).toBeInTheDocument();
    expect(screen.getByText("SKU must be unique")).toBeInTheDocument();
  });

  test("omits the list entirely without field errors and hides raw codes", () => {
    const error: ActionError = {
      code: "INTERNAL_ERROR",
      message: "Something went wrong.",
    };

    render(<ActionErrorAlert error={error} />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/INTERNAL_ERROR/)).not.toBeInTheDocument();
  });
});
