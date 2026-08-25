"use client";

import Link from "next/link";

import { Money } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasAnyRole } from "@/lib/auth/roles";
import type { RoleKey } from "@/lib/auth/roles";

import type { OrderDetailView } from "../schemas";

const STATUS_LABELS: Record<OrderDetailView["status"], string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

const STATUS_VARIANTS: Record<
  OrderDetailView["status"],
  "default" | "success" | "warning" | "destructive"
> = {
  draft: "warning",
  confirmed: "default",
  fulfilled: "success",
  cancelled: "destructive",
};

function formatDate(value: string | null): string {
  if (value === null) {
    return "—";
  }

  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Order detail: immutable snapshot lines plus lifecycle metadata. Totals
 * render only when the server projected them (Inventory never sees money).
 * Confirm/fulfill/cancel controls land with Phase 5; drafts surface the
 * edit path today.
 */
export function OrderDetail({
  order,
  currentRoles,
}: {
  order: OrderDetailView;
  currentRoles: RoleKey[];
}) {
  const canAuthor = hasAnyRole(currentRoles, ["admin", "sales"]);
  const isDraft = order.status === "draft";
  const showTotals = order.totalCents !== null;

  const timeline = [
    { label: "Created", at: order.createdAt, actor: order.creatorName },
    { label: "Confirmed", at: order.confirmedAt, actor: order.confirmedByName },
    { label: "Fulfilled", at: order.fulfilledAt, actor: order.fulfilledByName },
    { label: "Cancelled", at: order.cancelledAt, actor: order.cancelledByName },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-heading text-lg font-semibold">
            {order.orderNumber}
          </h2>
          <Badge variant={STATUS_VARIANTS[order.status]}>
            {STATUS_LABELS[order.status]}
          </Badge>
        </div>

        <div
          data-testid="order-action-slot"
          className="flex items-center gap-2"
        >
          {isDraft && canAuthor ? (
            <Link
              className={buttonVariants({ variant: "default", size: "sm" })}
              href={`/sales/orders/${order.id}/edit`}
            >
              Edit draft
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Customer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{order.customerName}</p>
            {order.customerCompanyName !== null ? (
              <p className="text-sm text-muted-foreground">
                {order.customerCompanyName}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {order.status === "cancelled"
                ? "Value before cancellation"
                : "Order total"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {order.totalCents !== null ? (
              <p className="text-lg font-semibold tabular-nums">
                <Money amountCents={order.totalCents} />
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Not visible</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {order.notes !== null && order.notes !== "" ? order.notes : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {showTotals ? (
        <section aria-label="Snapshot lines">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Product lines captured when this order was saved
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="py-2 font-medium">
                  Product
                </th>
                <th scope="col" className="py-2 font-medium">
                  Qty
                </th>
                <th scope="col" className="py-2 font-medium">
                  Unit price
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Line total
                </th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id} className="border-b border-border/60">
                  <td className="py-2 pr-4">
                    <span className="block font-medium">
                      {line.productName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {line.productSku}
                    </span>
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{line.quantity}</td>
                  <td className="py-2 pr-4">
                    <Money amountCents={line.unitPriceCents} />
                  </td>
                  <td className="py-2 text-right">
                    <Money amountCents={line.lineTotalCents} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-3 text-right font-medium">
                  Total
                </td>
                <td className="pt-3 text-right font-semibold tabular-nums">
                  <Money amountCents={order.totalCents ?? 0} />
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      ) : (
        <section aria-label="Snapshot lines">
          <ul className="space-y-1 text-sm">
            {order.lines.map((line) => (
              <li
                key={line.id}
                className="flex justify-between gap-4 border-b border-border/60 pb-1"
              >
                <span>
                  {line.productName}{" "}
                  <span className="text-muted-foreground">
                    ({line.productSku})
                  </span>
                </span>
                <span className="tabular-nums">× {line.quantity}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Lifecycle timeline">
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {timeline.map((entry) => (
            <div key={entry.label}>
              <dt className="text-sm text-muted-foreground">{entry.label}</dt>
              <dd className="text-sm">
                {formatDate(entry.at)}
                {entry.actor !== null ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {entry.actor}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        {order.cancellationReason !== null ? (
          <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <span className="font-medium">Cancellation reason:</span>{" "}
            {order.cancellationReason}
          </p>
        ) : null}
      </section>
    </div>
  );
}
