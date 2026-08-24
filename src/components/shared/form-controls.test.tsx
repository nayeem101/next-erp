import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import {
  ConfirmationDialog,
  SubmitButton,
} from "@/components/shared/form-controls";
import { FormErrorSummary } from "@/components/shared/form-error-summary";
import { CurrencyInput, QuantityInput } from "@/components/shared/inputs";
import type { ActionError } from "@/lib/errors/action-result";

describe("FormErrorSummary", () => {
  test("lists each field failure with a capitalized field name", () => {
    const error: ActionError = {
      code: "VALIDATION_ERROR",
      message: "Please review the highlighted fields.",
      fieldErrors: {
        displayName: ["Required"],
        reorderLevel: ["Must be at least 0"],
      },
    };

    render(<FormErrorSummary error={error} />);

    expect(screen.getByText(/please fix 2 issues below/i)).toBeInTheDocument();

    // Field name spans and messages share one <li>; assert list-item text.
    const items = screen.getAllByRole("listitem");

    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe("Display Name: Required");
    expect(items[1]?.textContent).toBe("Reorder Level: Must be at least 0");
  });

  test("falls back to the message when there are no field errors", () => {
    const error: ActionError = {
      code: "CONFLICT",
      message: "Someone else changed this record.",
    };

    render(<FormErrorSummary error={error} />);

    expect(
      screen.getByText("Someone else changed this record."),
    ).toBeInTheDocument();
  });
});

describe("SubmitButton", () => {
  test("disables and swaps the label while pending", () => {
    const view = render(<SubmitButton>Save product</SubmitButton>);

    expect(screen.getByRole("button", { name: "Save product" })).toBeEnabled();

    view.rerender(
      <SubmitButton pending pendingLabel="Saving product…">
        Save product
      </SubmitButton>,
    );

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText("Saving product…")).toBeInTheDocument();
  });
});

describe("ConfirmationDialog", () => {
  test("confirms through the callback and closes on cancel", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    const view = render(
      <ConfirmationDialog
        open
        onOpenChange={onOpenChange}
        title="Archive category"
        description="Archived categories disappear from selection lists."
        confirmLabel="Archive"
        destructive
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: /archive$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    view.rerender(
      <ConfirmationDialog
        open={false}
        onOpenChange={onOpenChange}
        title="Archive category"
        description="Archived categories disappear from selection lists."
        confirmLabel="Archive"
        destructive
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Reopening shows cancel; clicking it reports the state change.
    view.rerender(
      <ConfirmationDialog
        open
        onOpenChange={onOpenChange}
        title="Archive category"
        description="Archived categories disappear from selection lists."
        confirmLabel="Archive"
        destructive
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("shows children slot content such as inline errors", () => {
    render(
      <ConfirmationDialog
        open
        onOpenChange={vi.fn()}
        title="Disable account"
        description="The user loses access immediately."
        onConfirm={vi.fn()}
      >
        <p role="alert">Another admin must exist first.</p>
      </ConfirmationDialog>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /another admin must exist first/i,
    );
  });
});

describe("CurrencyInput", () => {
  function setup(valueCents: number | null = null) {
    const handle = vi.fn();

    const view = render(
      <CurrencyInput valueCents={valueCents} onValueChangeCents={handle} />,
    );

    const input = screen.getByRole("textbox");

    return { handle, input, view };
  }

  test("reports exact integer cents while typing", async () => {
    const user = userEvent.setup();
    const { handle, input } = setup();

    await user.type(input, "12.5");

    // 1 -> 100, 12 -> 1200, 12.5 -> 1250 (no float drift at any step).
    expect(handle).toHaveBeenLastCalledWith(1250);

    await user.type(input, "5");

    expect(handle).toHaveBeenLastCalledWith(1255);
  });

  test("ignores invalid characters without propagating values", async () => {
    const user = userEvent.setup();
    const { handle, input } = setup();

    await user.type(input, "abc");

    expect(handle).not.toHaveBeenCalled();

    await user.clear(input);

    expect(handle).toHaveBeenLastCalledWith(null);
  });

  test("round-trips external canonical values when not focused", async () => {
    const { input, view } = setup(1234);

    expect(input).toHaveValue("12.34");

    view.rerender(
      <CurrencyInput valueCents={5678} onValueChangeCents={vi.fn()} />,
    );

    await waitFor(() => {
      expect(input).toHaveValue("56.78");
    });

    expect(await screen.findByDisplayValue("56.78")).toBeInTheDocument();
  });
});

describe("QuantityInput", () => {
  test("propagates only whole numbers above the minimum", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<QuantityInput value={0} onValueChange={onChange} />);

    const input = screen.getByRole("textbox");

    await user.type(input, "42");

    // '4' then '42' both valid; negative or partial never fires.
    expect(onChange).toHaveBeenLastCalledWith(42);
    expect(onChange).not.toHaveBeenCalledWith(-1);
  });

  test("rejects letters and restores committed value on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<QuantityInput value={7} onValueChange={onChange} />);

    const input = screen.getByRole("textbox");

    await user.type(input, "x");

    expect(onChange).not.toHaveBeenCalled();

    await user.tab();

    expect(input).toHaveValue("7");
  });
});
