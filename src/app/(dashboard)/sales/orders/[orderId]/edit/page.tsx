import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { getOrder } from "@/features/orders/queries";
import {
  listActiveCustomerOptions,
  listActiveProductOptions,
} from "@/features/orders/selectors";
import { EditDraftWizard } from "@/features/orders/wizard/edit-draft-wizard";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edit draft order | NextERP",
};

interface PageProps {
  params: Promise<{ orderId: string }>;
}

async function EditDraftForm({ orderId }: { orderId: string }) {
  await connection();

  const [order, customerOptions, productOptions] = await Promise.all([
    getOrder(orderId, { includeTotals: true }),
    listActiveCustomerOptions(),
    listActiveProductOptions(),
  ]);

  if (!order) {
    notFound();
  }

  if (order.status !== "draft") {
    // Confirmed and beyond are immutable; send viewers to the detail page.
    return (
      <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        This order has been confirmed and can no longer be edited.{" "}
        <Link className="underline" href={`/sales/orders/${orderId}`}>
          View the order instead.
        </Link>
      </p>
    );
  }

  return (
    <EditDraftWizard
      draft={{
        orderId,
        version: order.version,
        customerId: order.customerId,
        customerName: order.customerName,
        notes: order.notes ?? "",
        lines: order.lines.map((line) => ({
          productId: line.productId,
          sku: line.productSku,
          name: line.productName,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
        })),
      }}
      customerOptions={customerOptions}
      productOptions={productOptions}
    />
  );
}

export default async function EditOrderPage(props: PageProps) {
  const { orderId } = await props.params;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Edit draft order</h1>
        <p className="text-sm text-muted-foreground">
          Adjust the customer or lines. Prices re-snapshot from current master
          data when you save.
        </p>
      </header>

      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <EditDraftForm orderId={orderId} />
      </Suspense>

      <Link
        className={buttonVariants({ variant: "ghost", size: "sm" })}
        href={`/sales/orders/${orderId}`}
      >
        Back to order
      </Link>
    </div>
  );
}
