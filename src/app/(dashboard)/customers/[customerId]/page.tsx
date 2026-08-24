import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/shared/data-table-skeleton";
import { Money } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { CustomerOrdersTable } from "@/features/customers/components/customer-orders-table";
import { CustomerStatusActions } from "@/features/customers/components/customer-status-actions";
import { getCustomer, listCustomerOrders } from "@/features/customers/queries";
import { listCustomerOrdersQuerySchema } from "@/features/customers/schemas";
import { getActionContext } from "@/lib/auth/guards";
import { parseListQuery } from "@/lib/list-query/parse";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Customer | NextERP",
};

interface PageProps {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function OrdersSection({
  customerId,
  searchParams,
}: {
  customerId: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Order history scopes its own URL state to page/pageSize; other
  // parameters are ignored so customer filters cannot poison the history.
  const raw = await searchParams;
  const { query } = parseListQuery(raw, listCustomerOrdersQuerySchema);

  const orderPage = await listCustomerOrders(customerId, query);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-base font-semibold">Order history</h2>

      <CustomerOrdersTable
        customerId={customerId}
        page={orderPage}
        urlValues={{
          page: query.page,
          pageSize: query.pageSize,
        }}
      />
    </section>
  );
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { customerId } = await params;

  const [customer, context] = await Promise.all([
    getCustomer(customerId),
    getActionContext(),
  ]);

  if (!customer) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href="/customers"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Back to customers
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-xl font-semibold">
              {customer.name}
            </h1>
            {customer.isActive ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="warning">Archived</Badge>
            )}
          </div>
          {customer.companyName !== null && (
            <p className="text-sm text-muted-foreground">
              {customer.companyName}
            </p>
          )}
        </div>

        <CustomerStatusActions
          customer={customer}
          currentRoles={context.ok ? [...context.user.roles] : []}
        />
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1">
            <CardDescription>Confirmed sales</CardDescription>
            <Money
              amountCents={customer.confirmedSalesCents}
              className="text-lg font-semibold"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-1">
            <CardDescription>Total orders</CardDescription>
            <span className="text-lg font-semibold tabular-nums">
              {customer.orderCount}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-1">
            <CardDescription>Open drafts</CardDescription>
            <span className="text-lg font-semibold tabular-nums">
              {customer.openDraftCount}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-1">
            <CardDescription>Status</CardDescription>
            <span className="text-sm">
              {customer.isActive
                ? "Available for orders"
                : "Hidden from new orders"}
            </span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-label="Contact" className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-semibold">Contact</h2>
          <p className="text-sm">{customer.email}</p>
          {customer.phone !== null && (
            <p className="text-sm text-muted-foreground">{customer.phone}</p>
          )}
        </section>

        <section aria-label="Billing address" className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-semibold">
            Billing address
          </h2>
          <p className="text-sm">{customer.addressLine1}</p>
          {customer.addressLine2 !== null && (
            <p className="text-sm">{customer.addressLine2}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {[customer.city, customer.region]
              .filter((part) => part !== null && part !== "")
              .join(", ")}
            , {customer.postalCode}, {customer.countryCode}
          </p>
        </section>
      </div>

      {customer.notes !== null && (
        <p className="max-w-2xl text-sm text-muted-foreground">
          {customer.notes}
        </p>
      )}

      <Suspense
        fallback={
          <DataTableSkeleton
            columnLabels={["Order", "Status", "Total", "Created", "Confirmed"]}
            rowCount={5}
          />
        }
      >
        <OrdersSection customerId={customerId} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
