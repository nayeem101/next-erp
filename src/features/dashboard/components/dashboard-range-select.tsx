"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { DASHBOARD_RANGE_OPTIONS, dashboardRangeHref } from "../schemas";

import type { DashboardRange } from "../schemas";

const LABELS: Record<DashboardRange, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
};

/** URL-state range selector; navigation stays server-rendered. */
export function DashboardRangeSelect({ value }: { value: DashboardRange }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <nav
      aria-label="Dashboard date range"
      aria-busy={isPending}
      className="flex rounded-md border"
    >
      {DASHBOARD_RANGE_OPTIONS.map((option) => {
        const isCurrent = option === value;

        return (
          <button
            key={option}
            aria-current={isCurrent ? "true" : undefined}
            className={
              isCurrent
                ? "bg-primary px-3 py-1.5 text-sm text-primary-foreground first:rounded-l-md last:rounded-r-md"
                : "px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md hover:bg-muted"
            }
            disabled={isPending}
            onClick={() => {
              startTransition(() => {
                router.push(dashboardRangeHref(option));
              });
            }}
            type="button"
          >
            {LABELS[option]}
          </button>
        );
      })}
    </nav>
  );
}
