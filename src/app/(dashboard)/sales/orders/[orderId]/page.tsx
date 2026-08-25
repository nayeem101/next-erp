import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { OrderDetail } from "@/features/orders/components/order-detail";
import { canViewFinancials } from "@/features/orders/domain";
import { getOrder } from "@/features/orders/queries";
import { getActionContext } from "@/lib/auth/guards";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order | NextERP",
};

interface PageProps {
  params: Promise<{ orderId: string }>;
}

async function OrderDetailContent({ orderId }: { orderId: string }) {
  await connection();

  const context = await getActionContext();
  const roles = context.ok ? [...context.user.roles] : [];

  const order = await getOrder(orderId, {
    includeTotals: canViewFinancials(roles),
  });

  if (!order) {
    notFound();
  }

  return <OrderDetail order={order} currentRoles={roles} />;
}

export default async function OrderDetailPage(props: PageProps) {
  const { orderId } = await props.params;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Order</h1>
        <p className="text-sm text-muted-foreground">
          Lines are immutable snapshots captured when the order was saved.
        </p>
      </header>

      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <OrderDetailContent orderId={orderId} />
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
