import { Suspense } from "react";

import { DashboardRangeSelect } from "@/features/dashboard/components/dashboard-range-select";
import { WidgetErrorBoundary } from "@/features/dashboard/components/widget-error-boundary";
import {
  LowStockWidget,
  RecentOrdersWidget,
  TopProductsWidget,
  RevenueWidget,
} from "@/features/dashboard/components/widgets";
import { dashboardVariantForRoles } from "@/features/dashboard/queries";
import { parseDashboardRange } from "@/features/dashboard/schemas";
import { getActionContext } from "@/lib/auth/guards";
import { hasAnyRole, MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard | NextERP",
};

function WidgetSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy={true}
      className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground"
    >
      Loading {label}…
    </div>
  );
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function DashboardContent({ searchParams }: PageProps) {
  const raw = await searchParams;
  const range = parseDashboardRange(raw);

  const context = await getActionContext();
  if (!context.ok) {
    return null;
  }

  const roles = context.user.roles;
  const variant = dashboardVariantForRoles(roles);
  const seesMoney = hasAnyRole(roles, MODULE_ROLE_REQUIREMENTS.invoices);
  const seesInventory = hasAnyRole(roles, MODULE_ROLE_REQUIREMENTS.inventory);

  return (
    <div className="flex flex-col gap-4">
      <DashboardRangeSelect value={range} />

      <div className="grid gap-4 lg:grid-cols-2">
        {seesMoney ? (
          <WidgetErrorBoundary title="Revenue over time">
            <Suspense fallback={<WidgetSkeleton label="revenue" />}>
              <RevenueWidget range={range} />
            </Suspense>
          </WidgetErrorBoundary>
        ) : null}

        <WidgetErrorBoundary title="Top products">
          <Suspense fallback={<WidgetSkeleton label="top products" />}>
            <TopProductsWidget range={range} variant={variant} />
          </Suspense>
        </WidgetErrorBoundary>

        {seesInventory ? (
          <WidgetErrorBoundary title="Low stock">
            <Suspense fallback={<WidgetSkeleton label="low stock" />}>
              <LowStockWidget />
            </Suspense>
          </WidgetErrorBoundary>
        ) : null}

        <WidgetErrorBoundary title="Recent orders">
          <Suspense fallback={<WidgetSkeleton label="recent orders" />}>
            <RecentOrdersWidget variant={variant} />
          </Suspense>
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}

export default function DashboardPage(props: PageProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Role-aware overview. Widgets stream independently.
        </p>
      </header>

      <DashboardContent searchParams={props.searchParams} />
    </div>
  );
}
