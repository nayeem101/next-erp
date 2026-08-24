"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  /** Stable identity used for selection callbacks and DOM keys. */
  id: string;
  label: string;
}

/**
 * Server-fed searchable combobox implementing the WAI-ARIA combobox
 * pattern: debounced remote loading, full keyboard navigation
 * (ArrowDown/ArrowUp/Enter/Escape), `aria-activedescendant` highlighting,
 * and an explicit empty state. Filtering happens server-side — every query
 * keystroke (after debounce) is sent to `loadOptions` untouched.
 */
export function SearchableCombobox({
  loadOptions,
  value,
  onChange,
  placeholder = "Search…",
  ariaLabel,
  emptyMessage = "No matches found.",
  debounceMs = 250,
  disabled = false,
  className,
}: {
  loadOptions: (query: string) => Promise<ComboboxOption[]>;
  value: ComboboxOption | null;
  onChange: (option: ComboboxOption | null) => void;
  placeholder?: string;
  ariaLabel: string;
  emptyMessage?: string;
  debounceMs?: number;
  disabled?: boolean;
  className?: string;
}) {
  const listboxId = React.useId();
  const [draft, setDraft] = React.useState(value?.label ?? "");
  const [options, setOptions] = React.useState<ComboboxOption[]>([]);
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);

  // Reseed the draft when the canonical value changes externally.
  const [prevValueId, setPrevValueId] = React.useState(value?.id ?? null);

  if ((value?.id ?? null) !== prevValueId) {
    setPrevValueId(value?.id ?? null);
    setDraft(value?.label ?? "");
    setOptions([]);
    setOpen(false);
  }

  React.useEffect(() => {
    if (!open || !draft.trim()) {
      return;
    }

    const query = draft.trim();
    let cancelled = false;

    // The loading flag flips inside the timer too, so the effect body never
    // calls setState synchronously (no render cascades).
    const timeout = setTimeout(() => {
      setIsLoading(true);

      void loadOptions(query)
        .then((result) => {
          if (!cancelled) {
            setOptions(result);
            setActiveIndex(-1);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsLoading(false);
          }
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [draft, open, debounceMs, loadOptions]);

  function select(option: ComboboxOption): void {
    onChange(option);
    setOpen(false);
    setActiveIndex(-1);
    setDraft(option.label);
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (!open) {
      if (event.key === "ArrowDown" && options.length > 0) {
        setOpen(true);
        setActiveIndex(0);
      }

      return;
    }

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();

        setActiveIndex((index) =>
          options.length === 0 ? -1 : Math.min(index + 1, options.length - 1),
        );

        break;
      }
      case "ArrowUp": {
        event.preventDefault();

        setActiveIndex((index) => Math.max(index - 1, -1));

        break;
      }
      case "Enter": {
        const active = options[activeIndex];

        if (active) {
          event.preventDefault();
          select(active);
        }

        break;
      }
      case "Escape": {
        setOpen(false);
        setActiveIndex(-1);

        break;
      }
      default: {
        break;
      }
    }
  }

  const activeId =
    activeIndex >= 0 && open
      ? `${listboxId}-option-${String(activeIndex)}`
      : undefined;

  const showList =
    open && (options.length > 0 || isLoading || draft.trim() !== "");

  return (
    <div className={cn("relative", className)}>
      <Input
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={draft}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          // Defer so option mousedown can commit before the list unmounts.
          setTimeout(() => {
            setOpen(false);
          }, 0);
        }}
        onKeyDown={(event) => {
          handleKeyDown(event);
        }}
        onChange={(event) => {
          const next = event.target.value;

          setDraft(next);
          setOpen(true);

          if (next.trim() === "") {
            setOptions([]);
            setActiveIndex(-1);
            onChange(null);
          }
        }}
      />

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-40 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-md"
        >
          {isLoading && (
            <li
              aria-live="polite"
              className="px-2 py-1.5 text-sm text-muted-foreground"
            >
              Searching…
            </li>
          )}

          {!isLoading && options.length === 0 && (
            <li
              aria-live="polite"
              className="px-2 py-1.5 text-sm text-muted-foreground"
            >
              {emptyMessage}
            </li>
          )}

          {!isLoading &&
            options.map((option, index) => (
              <li
                key={option.id}
                id={`${listboxId}-option-${String(index)}`}
                role="option"
                aria-selected={value?.id === option.id}
                data-highlighted={index === activeIndex || undefined}
                className="cursor-pointer rounded px-2 py-1.5 text-sm hover:bg-muted/50 data-highlighted:bg-muted"
                onMouseDown={(event) => {
                  // Commit before the input's blur handler closes the list.
                  event.preventDefault();
                  select(option);
                }}
                onClick={() => {
                  select(option);
                }}
              >
                {option.label}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
