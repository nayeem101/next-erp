import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Exhaustive typed status presentation. Every domain status maps to a label
 * and a visual variant; adding a database enum value without extending this
 * map is a type error, not a silent rendering bug.
 */

export const ORDER_STATUS_LABELS = {
  draft: "Draft",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
} as const;

export const INVOICE_STATUS_LABELS = {
  issued: "Issued",
  void: "Void",
} as const;

export const ENTITY_ACTIVE_LABELS = {
  active: "Active",
  archived: "Archived",
} as const;

export const STOCK_LEVEL_LABELS = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
} as const;

const statusBadgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "border-border bg-muted/40 text-foreground",
        info: "border-transparent bg-sky-500/10 text-sky-700 dark:text-sky-400",
        success:
          "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        warning:
          "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
        destructive:
          "border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface StatusBadgeProps extends VariantProps<
  typeof statusBadgeVariants
> {
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({
  children,
  className,
  variant = "neutral",
}: StatusBadgeProps) {
  return (
    <span
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ variant, className }))}
    >
      {children}
    </span>
  );
}

/** Order lifecycle mapping. */
export function OrderStatusBadge({
  status,
}: {
  status: keyof typeof ORDER_STATUS_LABELS;
}) {
  const variants = {
    cancelled: "destructive",
    confirmed: "info",
    draft: "neutral",
    fulfilled: "success",
  } as const;

  return (
    <StatusBadge variant={variants[status]}>
      {ORDER_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

/** Invoice lifecycle mapping. */
export function InvoiceStatusBadge({
  status,
}: {
  status: keyof typeof INVOICE_STATUS_LABELS;
}) {
  const variants = {
    issued: "info",
    void: "destructive",
  } as const;

  return (
    <StatusBadge variant={variants[status]}>
      {INVOICE_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

/** Master-data active/archived mapping. */
export function EntityActiveBadge({
  state,
}: {
  state: keyof typeof ENTITY_ACTIVE_LABELS;
}) {
  const variants = {
    active: "success",
    archived: "warning",
  } as const;

  return (
    <StatusBadge variant={variants[state]}>
      {ENTITY_ACTIVE_LABELS[state]}
    </StatusBadge>
  );
}

/** Stock-level projection mapping. */
export function StockLevelBadge({
  level,
}: {
  level: keyof typeof STOCK_LEVEL_LABELS;
}) {
  const variants = {
    in_stock: "success",
    low_stock: "warning",
    out_of_stock: "destructive",
  } as const;

  return (
    <StatusBadge variant={variants[level]}>
      {STOCK_LEVEL_LABELS[level]}
    </StatusBadge>
  );
}
