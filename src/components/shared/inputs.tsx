"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Parses a major-unit decimal string into integer cents without floats. */
export function parseMajorUnitsToCents(raw: string): number | null {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return null;
  }

  const normalized = trimmed.replace(/,/g, "");
  const match = /^-?\d+(\.\d{1,2})?$/.exec(normalized);

  if (!match) {
    return null;
  }

  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = normalized.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));

  return negative ? -cents : cents;
}

function centsToMajorUnits(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);

  const whole = String(Math.floor(abs / 100));
  const fraction = String(abs % 100).padStart(2, "0");

  return `${sign}${whole}.${fraction}`;
}

/**
 * Money entry bound to the serialized-cents contract. The visible value is
 * major units; every change reports integer cents (or null when empty or
 * incomplete), so no float ever reaches persistence.
 */
export function CurrencyInput({
  valueCents,
  onValueChangeCents,
  currency = "USD",
  disabled,
  className,
  id,
}: {
  /** Current amount in integer cents; null renders empty. */
  valueCents: number | null;
  onValueChangeCents: (cents: number | null) => void;
  currency?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const [draft, setDraft] = React.useState(() =>
    valueCents === null ? "" : centsToMajorUnits(valueCents),
  );
  const [focused, setFocused] = React.useState(false);

  const canonicalDraft =
    valueCents === null ? "" : centsToMajorUnits(valueCents);

  const [prevValueCents, setPrevValueCents] = React.useState(valueCents);

  // External canonical updates (server round-trips) refresh the field while
  // it is not being edited — the React-blessed "adjust state on prop change"
  // render-time reset, which avoids effect cascades.
  if (!focused && prevValueCents !== valueCents) {
    setPrevValueCents(valueCents);
    setDraft(canonicalDraft);
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="text-sm text-muted-foreground tabular-nums"
      >
        {currency}
      </span>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        disabled={disabled}
        aria-invalid={
          draft.trim() !== "" && parseMajorUnitsToCents(draft) === null
        }
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setDraft(valueCents === null ? "" : centsToMajorUnits(valueCents));
        }}
        onChange={(event) => {
          const next = event.target.value;

          setDraft(next);

          if (next.trim() === "") {
            onValueChangeCents(null);

            return;
          }

          const cents = parseMajorUnitsToCents(next);

          if (cents !== null) {
            onValueChangeCents(cents);
          }
        }}
        className="w-32"
      />
    </div>
  );
}

const QUANTITY_PATTERN = /^\d+$/;

/**
 * Non-negative integer entry for stock quantities and counts. Invalid input
 * never propagates; the callback only fires with whole numbers.
 */
export function QuantityInput({
  value,
  onValueChange,
  min = 0,
  disabled,
  className,
  id,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const [draft, setDraft] = React.useState(String(value));
  const [prevValue, setPrevValue] = React.useState(value);

  // Same render-time reset pattern as CurrencyInput: external canonical
  // value changes re-seed the draft without effect cascades.
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(String(value));
  }

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      pattern="\d*"
      autoComplete="off"
      value={draft}
      disabled={disabled}
      className={cn("w-24", className)}
      onChange={(event) => {
        const next = event.target.value;

        setDraft(next);

        if (!QUANTITY_PATTERN.test(next)) {
          return;
        }

        const parsed = Number(next);

        if (parsed >= min) {
          onValueChange(parsed);
        }
      }}
      onBlur={() => {
        // Snap invalid drafts back to the last committed value.
        if (!QUANTITY_PATTERN.test(draft) || Number(draft) < min) {
          setDraft(String(value));
        }
      }}
    />
  );
}
