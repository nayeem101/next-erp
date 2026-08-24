import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { CustomerForm } from "@/features/customers/components/customer-form";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New customer | NextERP",
};

async function NewCustomerForm() {
  // No dynamic APIs are read on this route; opt into request time so the
  // static shell prerenders without a database.
  await connection();

  return <CustomerForm mode="create" />;
}

export default function NewCustomerPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">New customer</h1>
        <p className="text-sm text-muted-foreground">
          Create a customer account with billing contact and address.
        </p>
      </header>

      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <NewCustomerForm />
      </Suspense>

      <Link
        className={buttonVariants({ variant: "ghost", size: "sm" })}
        href="/customers"
      >
        Back to customers
      </Link>
    </div>
  );
}
