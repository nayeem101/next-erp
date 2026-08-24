import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CustomerForm } from "@/features/customers/components/customer-form";
import { getCustomer } from "@/features/customers/queries";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edit customer | NextERP",
};

interface PageProps {
  params: Promise<{ customerId: string }>;
}

async function EditCustomerForm({ customerId }: { customerId: string }) {
  const customer = await getCustomer(customerId);

  if (!customer) {
    notFound();
  }

  return <CustomerForm mode="edit" customer={customer} />;
}

export default async function EditCustomerPage(props: PageProps) {
  const { customerId } = await props.params;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Edit customer</h1>
        <p className="text-sm text-muted-foreground">
          Update contact and billing details. Changes are audit-logged as a
          field-level diff.
        </p>
      </header>

      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <EditCustomerForm customerId={customerId} />
      </Suspense>
    </div>
  );
}
