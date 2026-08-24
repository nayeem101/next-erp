import { CircleAlertIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Locale display for serialized ISO timestamps with the exact UTC instant in
 * a tooltip. Server data is always UTC; users see their locale rendering
 * while auditors can hover for the precise source value.
 */
export function LocalDateTime({
  value,
  className,
}: {
  /** Serialized ISO-8601 timestamp (server contract). */
  value: string;
  className?: string;
}) {
  const date = new Date(value);

  const locale = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

  const exactUtc = `${date.toISOString().replace("T", " ").replace("Z", "")} UTC`;

  return (
    <time
      dateTime={value}
      title={exactUtc}
      className={cn("tabular-nums", className)}
    >
      {locale}
    </time>
  );
}

/**
 * Formats serialized integer cents via Intl. Cents never cross the client
 * boundary as floats, so formatting is exact by construction.
 */
export function Money({
  amountCents,
  currency = "USD",
  className,
}: {
  amountCents: number | string;
  currency?: string;
  className?: string;
}) {
  const cents =
    typeof amountCents === "string" ? Number(amountCents) : amountCents;

  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(cents / 100);

  return (
    <span data-slot="money" className={cn("tabular-nums", className)}>
      {formatted}
    </span>
  );
}

/**
 * Grid/list empty state. The filtered variant explains that narrowing
 * filters — not missing data — produced the empty result.
 */
export function EmptyState({
  title,
  description,
  icon: Icon = CircleAlertIcon,
  action,
  filtered = false,
  className,
}: {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  /** True when the list has data but active filters hid it all. */
  filtered?: boolean;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center",
        className,
      )}
    >
      <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium">{title}</p>
      <p className="max-w-prose text-sm text-muted-foreground">
        {filtered
          ? "No results match the current filters. Adjust or reset them to widen the search."
          : description}
      </p>
      {action}
    </div>
  );
}
