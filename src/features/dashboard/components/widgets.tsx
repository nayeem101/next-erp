import Link from "next/link";

import { Money } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { getLowStock, getRecentOrders, getTopProducts } from "../queries";

import { RevenueChart } from "./revenue-chart";

import type {
  DashboardRange,
  DashboardVariant,
  LowStockRow,
  RecentOrderRow,
  TopProductRow,
} from "../schemas";

/**
 * Server-owned widget wrappers: authorize upstream in the page shell,
 * derive the projection variant server-side, and hand serialized data to
 * client renderers. Each is independently suspended and error-bounded.
 */

function EmptyNote({ children }: { children: string }) {
  return (
    <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export async function RevenueWidget({ range }: { range: DashboardRange }) {
  const { getRevenueOverTime } = await import("../queries");
  const series = await getRevenueOverTime(range);
  const hasSales = series.points.some((point) => point.revenueCents !== 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">Revenue over time</CardTitle>
        <span className="text-xs text-muted-foreground">
          Net sales revenue, {series.granularity}
        </span>
      </CardHeader>
      <CardContent>
        {hasSales ? (
          <RevenueChart
            granularity={series.granularity}
            points={series.points}
          />
        ) : (
          <EmptyNote>No sales in this period.</EmptyNote>
        )}
      </CardContent>
    </Card>
  );
}

export async function TopProductsWidget({
  variant,
  range,
}: {
  variant: DashboardVariant;
  range: DashboardRange;
}) {
  const rows = await getTopProducts(
    variant === "operations" ? "units" : variant,
    range,
  );

  const showsMoney = variant === "sales";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">Top products</CardTitle>
        <span className="text-xs text-muted-foreground">
          {showsMoney ? "By net units sold" : "Units only"}
        </span>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyNote>No sales in this period.</EmptyNote>
        ) : (
          <>
            <table className="w-full text-sm">
              <caption className="sr-only">
                Top products by net units sold
              </caption>
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1 font-medium" scope="col">
                    Product
                  </th>
                  <th className="py-1 text-right font-medium" scope="col">
                    Units
                  </th>
                  {showsMoney ? (
                    <th className="py-1 text-right font-medium" scope="col">
                      Revenue
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row: TopProductRow) => (
                  <tr key={row.productId} className="border-b border-border/50">
                    <td className="py-1.5 pr-2">{row.productName}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {row.netUnits}
                    </td>
                    {showsMoney ? (
                      <td className="py-1.5 text-right tabular-nums">
                        <Money amountCents={row.revenueCents ?? 0} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {!showsMoney ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Revenue figures are not visible for your role.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export async function LowStockWidget() {
  const rows = await getLowStock();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">Low stock</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyNote>No low-stock products.</EmptyNote>
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map((row: LowStockRow) => (
              <li
                key={row.productId}
                className="flex items-center justify-between gap-2"
              >
                <Link
                  className="underline-offset-4 hover:underline"
                  href={`/inventory/products?q=${encodeURIComponent(row.sku)}`}
                >
                  {row.productName}
                </Link>
                <Badge
                  variant={row.stockOnHand === 0 ? "destructive" : "warning"}
                >
                  {row.stockOnHand === 0
                    ? "Out of stock"
                    : `${String(row.stockOnHand)} left`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

export async function RecentOrdersWidget({
  variant,
}: {
  variant: DashboardVariant;
}) {
  const rows = await getRecentOrders(
    variant === "sales" ? "sales" : "operations",
  );
  const showsMoney = variant === "sales";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">Recent orders</CardTitle>
        <Link
          className="text-xs underline underline-offset-4"
          href="/sales/orders"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyNote>No orders yet.</EmptyNote>
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map((row: RecentOrderRow) => (
              <li
                key={row.orderId}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2">
                  <Link
                    className="font-medium underline-offset-4 hover:underline"
                    href={`/sales/orders/${row.orderId}`}
                  >
                    {row.orderNumber}
                  </Link>
                  <span className="text-muted-foreground">
                    {row.customerName}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {showsMoney && row.totalCents !== null ? (
                    <Money amountCents={row.totalCents} />
                  ) : null}
                  <Badge variant="outline">
                    {ORDER_STATUS_LABELS[row.status] ?? row.status}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
