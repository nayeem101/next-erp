import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import {
  SearchableCombobox,
  type ComboboxOption,
} from "@/components/shared/searchable-combobox";

const options: ComboboxOption[] = [
  { id: "c1", label: "Acme Corporation" },
  { id: "c2", label: "Beta Industries" },
];

function setup(
  loadOptions: (query: string) => Promise<ComboboxOption[]>,
  props: Partial<Parameters<typeof SearchableCombobox>[0]> = {},
) {
  const onChange = vi.fn();

  const view = render(
    <SearchableCombobox
      loadOptions={loadOptions}
      value={null}
      onChange={onChange}
      ariaLabel="Customer"
      {...props}
    />,
  );

  const input = screen.getByRole("combobox", { name: "Customer" });

  return { input, onChange, view };
}

describe("SearchableCombobox", () => {
  test("debounces remote loading and lists server results", async () => {
    vi.useFakeTimers();
    const loadOptions = vi.fn().mockResolvedValue(options);
    const { input } = setup(loadOptions, { debounceMs: 250 });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ac" } });

    // Rescheduled per keystroke; nothing fetched before the debounce ends.
    fireEvent.change(input, { target: { value: "acme" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(loadOptions).toHaveBeenCalledTimes(1);
    expect(loadOptions).toHaveBeenCalledWith("acme");

    await vi.advanceTimersByTimeAsync(0);

    expect(
      screen.getByRole("option", { name: "Acme Corporation" }),
    ).toBeInTheDocument();
  });

  test("keyboard navigation highlights and Enter selects", async () => {
    vi.useFakeTimers();
    const loadOptions = vi.fn().mockResolvedValue(options);
    const { input, onChange } = setup(loadOptions);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "co" } });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(input.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input.getAttribute("aria-activedescendant")).toMatch(/option-0$/);

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input.getAttribute("aria-activedescendant")).toMatch(/option-1$/);

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(options[1]);
    expect((input as HTMLInputElement).value).toBe("Beta Industries");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("Escape closes the list without selecting", async () => {
    vi.useFakeTimers();
    const loadOptions = vi.fn().mockResolvedValue(options);
    const { input, onChange } = setup(loadOptions);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "be" } });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("shows the empty state when the server returns nothing", async () => {
    vi.useFakeTimers();
    const loadOptions = vi.fn().mockResolvedValue([]);
    setup(loadOptions, { emptyMessage: "No customers matched." });

    const input = screen.getByRole("combobox", { name: "Customer" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzz" } });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByText("No customers matched.")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  test("shows a searching status while the request is in flight", async () => {
    let resolveFetch: ((value: ComboboxOption[]) => void) | undefined;
    const loadOptions = vi.fn().mockImplementation(
      () =>
        new Promise<ComboboxOption[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    setup(loadOptions);

    const input = screen.getByRole("combobox", { name: "Customer" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ac" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByText("Searching…")).toBeInTheDocument();

    await act(async () => {
      resolveFetch?.(options);
      // Flush the promise chain under fake timers.
      await vi.runAllTimersAsync();
    });

    expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Acme Corporation" }),
    ).toBeInTheDocument();
  });

  test("clearing the input reports null and hides results", async () => {
    vi.useFakeTimers();
    const loadOptions = vi.fn().mockResolvedValue(options);
    const { input, onChange } = setup(loadOptions, {
      value: options[0] ?? null,
    });

    expect((input as HTMLInputElement).value).toBe("Acme Corporation");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
