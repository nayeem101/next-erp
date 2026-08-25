import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  listActiveCustomerOptions,
  listActiveProductOptions,
} from "@/features/orders/selectors";
import { NewOrderWizard } from "@/features/orders/wizard/new-order-wizard";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New order | NextERP",
};

async function OrderWizardOptions() {
  // No dynamic APIs are read on this route; opt into request time so the
  // static shell prerenders without a database.
  await connection();

  const [customerOptions, productOptions] = await Promise.all([
    listActiveCustomerOptions(),
    listActiveProductOptions(),
  ]);

  return (
    <NewOrderWizard
      customerOptions={customerOptions}
      productOptions={productOptions}
    />
  );
}

export default function NewOrderPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">New order</h1>
        <p className="text-sm text-muted-foreground">
          Pick a customer, add products, and save the draft. Nothing is billed
          until the order is confirmed.
        </p>
      </header>

      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <OrderWizardOptions />
      </Suspense>

      <Link
        className={buttonVariants({ variant: "ghost", size: "sm" })}
        href="/sales/orders"
      >
        Back to orders
      </Link>
    </div>
  );
}
